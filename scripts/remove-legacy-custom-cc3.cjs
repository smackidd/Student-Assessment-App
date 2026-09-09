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

function isLegacyCustomCc3(template) {
  return template
    && template.id !== "cc3"
    && String(template.category || "").trim().toLowerCase() === "custom"
    && String(template.name || "").trim().toLowerCase() === "cc3";
}

function parseState(value) {
  if (typeof value === "string") return JSON.parse(value);
  if (value && typeof value === "object") return value;
  throw new Error("The main workspace state is missing or invalid.");
}

function sqlJson(value) {
  const json = JSON.stringify(value);
  let tag = "$cc3_migration$";
  while (json.includes(tag)) tag = `$cc3_migration_${tag.length}$`;
  return `${tag}${json}${tag}::jsonb`;
}

async function loadWorkspace(sql) {
  const result = await sql.run(["SELECT id, state_json FROM public.prototype_workspace_state WHERE id = 'main';"]);
  const row = result[0].rows[0];
  if (!row) throw new Error("The main workspace row was not found.");
  return { id: row.id, state: parseState(row.state_json) };
}

async function run() {
  const sql = await createSqlSession({ projectId, instanceId, databaseId, accountEmail, temporaryAdmin });
  try {
    const before = await loadWorkspace(sql);
    const templates = Array.isArray(before.state.templates) ? before.state.templates : [];
    const removed = templates.filter(isLegacyCustomCc3);
    const nextState = {
      ...before.state,
      templates: templates.filter((template) => !isLegacyCustomCc3(template))
    };
    const summary = {
      projectId,
      workspaceId: before.id,
      templatesBefore: templates.length,
      templatesAfter: nextState.templates.length,
      removed: removed.map((template) => ({ id: template.id, name: template.name, category: template.category })),
      mode: apply ? "apply" : check ? "check-and-rollback" : "dry-run"
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!removed.length || (!apply && !check)) return;

    const commands = [
      "BEGIN;",
      `UPDATE public.prototype_workspace_state SET state_json = ${sqlJson(nextState)}, updated_at = CURRENT_TIMESTAMP WHERE id = 'main';`,
      "SELECT jsonb_array_length(state_json -> 'templates')::int AS templates FROM public.prototype_workspace_state WHERE id = 'main';",
      check ? "ROLLBACK;" : "COMMIT;"
    ];
    const result = await sql.run(commands);
    const inTransactionCount = Number(result[2].rows[0]?.templates ?? -1);
    if (inTransactionCount !== nextState.templates.length) {
      throw new Error("Workspace template count did not match the planned migration.");
    }

    const after = await loadWorkspace(sql);
    const afterTemplates = Array.isArray(after.state.templates) ? after.state.templates : [];
    const afterDuplicateCount = afterTemplates.filter(isLegacyCustomCc3).length;
    const expectedCount = check ? templates.length : nextState.templates.length;
    if (afterTemplates.length !== expectedCount || (!check && afterDuplicateCount !== 0)) {
      throw new Error("Post-migration verification failed.");
    }
    console.log(JSON.stringify({
      status: check ? "verified-and-rolled-back" : "applied-and-verified",
      projectId,
      templates: afterTemplates.length,
      legacyCustomCc3Definitions: afterDuplicateCount,
      backupUri: projectId === productionProjectId ? backupUri : undefined
    }));
  } finally {
    await sql.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
