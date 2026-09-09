const { createSqlSession } = require("./data-connect-sql-session.cjs");

const productionProjectId = "student-assessment-2d869";
const testProjectId = "student-assessment-test";
const instanceId = "student-assessment-db";
const databaseId = "student_assessment";
const accountEmail = process.env.FIREBASE_ACCOUNT || "stevemackidd@gmail.com";
const projectId = argumentValue("--project") || testProjectId;
const confirmProject = argumentValue("--confirm-project");
const backupUri = argumentValue("--backup-uri");
const apply = process.argv.includes("--apply");
const check = process.argv.includes("--check");
const allowProduction = process.argv.includes("--allow-production");
const temporaryAdmin = process.argv.includes("--temporary-admin");

const studentDataTables = [
  "assessment_result_value",
  "assessment_file_link",
  "assessment_result",
  "assessment_session",
  "student_note",
  "generated_report",
  "spreadsheet_import_mapping",
  "spreadsheet_import",
  "audit_event",
  "uploaded_file",
  "student_enrollment",
  "student"
];

if (apply && check) throw new Error("Choose either --apply or --check, not both.");
if ((apply || check) && confirmProject !== projectId) {
  throw new Error(`Refusing to write without --confirm-project ${projectId}.`);
}
if (projectId === productionProjectId && !allowProduction) {
  throw new Error("Refusing to target production without --allow-production.");
}
if (projectId === productionProjectId && apply && !backupUri?.startsWith("gs://")) {
  throw new Error("Production apply requires a verified --backup-uri gs://... value.");
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function quotedIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function parseState(value) {
  if (typeof value === "string") return JSON.parse(value);
  if (value && typeof value === "object") return value;
  throw new Error("The main workspace state is missing or invalid.");
}

function sqlJson(value) {
  const json = JSON.stringify(value);
  let tag = "$student_purge$";
  while (json.includes(tag)) tag = `$student_purge_${tag.length}$`;
  return `${tag}${json}${tag}::jsonb`;
}

function scrubWorkspace(state) {
  return {
    ...state,
    rows: [],
    placements: [],
    importLogs: [],
    auditEvents: [],
    pendingStudentSync: false
  };
}

function countQuery() {
  return studentDataTables
    .map((table) => `SELECT '${table}' AS table_name, count(*)::int AS rows FROM public.${quotedIdentifier(table)}`)
    .join("\nUNION ALL\n");
}

async function snapshot(sql) {
  const results = await sql.run([
    countQuery(),
    `SELECT id,
            state_json,
            jsonb_array_length(COALESCE(state_json -> 'rows', '[]'::jsonb))::int AS workspace_rows,
            jsonb_array_length(COALESCE(state_json -> 'placements', '[]'::jsonb))::int AS placements,
            jsonb_array_length(COALESCE(state_json -> 'importLogs', '[]'::jsonb))::int AS import_logs,
            jsonb_array_length(COALESCE(state_json -> 'auditEvents', '[]'::jsonb))::int AS workspace_audit_events
       FROM public.prototype_workspace_state
      WHERE id = 'main';`
  ], true);
  const workspace = results[1].rows[0];
  if (!workspace) throw new Error("The main workspace row was not found.");
  return {
    tableCounts: Object.fromEntries(results[0].rows.map((row) => [row.table_name, Number(row.rows)])),
    workspace: {
      rows: Number(workspace.workspace_rows),
      placements: Number(workspace.placements),
      importLogs: Number(workspace.import_logs),
      auditEvents: Number(workspace.workspace_audit_events)
    },
    state: parseState(workspace.state_json)
  };
}

function publicSummary(snapshotValue) {
  return {
    tables: snapshotValue.tableCounts,
    workspace: snapshotValue.workspace
  };
}

function isEmpty(snapshotValue) {
  return Object.values(snapshotValue.tableCounts).every((count) => count === 0)
    && Object.values(snapshotValue.workspace).every((count) => count === 0);
}

async function run() {
  const sql = await createSqlSession({ projectId, instanceId, databaseId, accountEmail, temporaryAdmin });
  try {
    const before = await snapshot(sql);
    console.log(JSON.stringify({
      projectId,
      mode: apply ? "apply" : check ? "check-and-rollback" : "dry-run",
      before: publicSummary(before),
      preserved: [
        "assessment definitions, rounds, fields, and grade assignments",
        "school years, grade groups, homerooms, and overview settings",
        "staff users, roles, and Firebase Authentication accounts"
      ],
      outsideDatabaseScope: ["Cloud Storage objects", "Firestore documents"]
    }, null, 2));
    if (!apply && !check) return;

    const scrubbedState = scrubWorkspace(before.state);
    const truncateSql = `TRUNCATE TABLE ${studentDataTables
      .map((table) => `public.${quotedIdentifier(table)}`)
      .join(", ")} RESTART IDENTITY CASCADE;`;
    const commands = [
      "BEGIN;",
      `UPDATE public.prototype_workspace_state SET state_json = ${sqlJson(scrubbedState)}, updated_at = CURRENT_TIMESTAMP WHERE id = 'main';`,
      truncateSql,
      countQuery(),
      `SELECT
         jsonb_array_length(COALESCE(state_json -> 'rows', '[]'::jsonb))::int AS workspace_rows,
         jsonb_array_length(COALESCE(state_json -> 'placements', '[]'::jsonb))::int AS placements,
         jsonb_array_length(COALESCE(state_json -> 'importLogs', '[]'::jsonb))::int AS import_logs,
         jsonb_array_length(COALESCE(state_json -> 'auditEvents', '[]'::jsonb))::int AS workspace_audit_events
       FROM public.prototype_workspace_state WHERE id = 'main';`,
      check ? "ROLLBACK;" : "COMMIT;"
    ];
    const result = await sql.run(commands);
    const inTransactionTables = Object.fromEntries(result[3].rows.map((row) => [row.table_name, Number(row.rows)]));
    const inTransactionWorkspace = result[4].rows[0];
    if (
      Object.values(inTransactionTables).some((count) => count !== 0)
      || Object.values(inTransactionWorkspace).some((count) => Number(count) !== 0)
    ) {
      throw new Error("The in-transaction student-data purge verification failed.");
    }

    const after = await snapshot(sql);
    if (check) {
      if (JSON.stringify(publicSummary(after)) !== JSON.stringify(publicSummary(before))) {
        throw new Error("The check transaction did not roll back to the original counts.");
      }
    } else if (!isEmpty(after)) {
      throw new Error("Production student-data purge verification found remaining database records.");
    }
    console.log(JSON.stringify({
      status: check ? "verified-and-rolled-back" : "applied-and-verified",
      projectId,
      after: publicSummary(after),
      backupUri: projectId === productionProjectId ? backupUri : undefined
    }, null, 2));
  } finally {
    await sql.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
