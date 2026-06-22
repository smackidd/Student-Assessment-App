const path = require("node:path");

const firebaseToolsRoot = path.join(process.env.APPDATA, "npm", "node_modules", "firebase-tools", "lib");
const auth = require(path.join(firebaseToolsRoot, "auth"));
const { executeSqlCmdsAsIamUser } = require(path.join(firebaseToolsRoot, "gcp", "cloudsql", "connect"));

const projectId = "student-assessment-2d869";
const instanceId = "student-assessment-db";
const databaseId = "student_assessment";
const accountEmail = process.env.FIREBASE_ACCOUNT || "stevemackidd@gmail.com";
const wipe = process.argv.includes("--wipe");

const appTables = [
  "assessment_file_link",
  "assessment_result_value",
  "assessment_result",
  "assessment_session",
  "spreadsheet_import_mapping",
  "spreadsheet_import",
  "student_note",
  "overview_column_preference",
  "overview_lock",
  "generated_report",
  "audit_event",
  "uploaded_file",
  "assessment_field",
  "assessment_round",
  "assessment_grade_group",
  "assessment_definition",
  "student_enrollment",
  "homeroom",
  "grade_group",
  "school_year",
  "user_role",
  "role",
  "student",
  "user",
  "prototype_workspace_state"
];

function quotedIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function run() {
  const selectedAccount = auth.selectAccount(accountEmail, process.cwd());
  if (!selectedAccount) {
    throw new Error(`Firebase account ${accountEmail} is not logged in.`);
  }

  const options = { project: projectId, nonInteractive: true };
  auth.setActiveAccount(options, selectedAccount);

  const tableListResult = await executeSqlCmdsAsIamUser(
    options,
    instanceId,
    databaseId,
    [
      `SELECT tablename
       FROM pg_tables
       WHERE schemaname = 'public'
       ORDER BY tablename;`
    ],
    true
  );
  const existingTables = new Set(tableListResult[0].rows.map((row) => row.tablename));
  const tablesToClear = appTables.filter((table) => existingTables.has(table));

  if (!tablesToClear.length) {
    console.log("No app tables found to clear. Existing public tables:");
    console.table(tableListResult[0].rows);
    return;
  }

  const countQuery = tablesToClear
    .map((table) => `SELECT '${table}' AS table_name, count(*)::int AS rows FROM public.${quotedIdentifier(table)}`)
    .join("\nUNION ALL\n");

  const beforeCounts = await executeSqlCmdsAsIamUser(options, instanceId, databaseId, [countQuery], true);
  console.log("Rows before cleanup:");
  console.table(beforeCounts[0].rows);

  if (!wipe) {
    console.log("Dry run only. Re-run with --wipe to truncate these tables.");
    return;
  }

  const truncateSql = `TRUNCATE TABLE ${tablesToClear.map((table) => `public.${quotedIdentifier(table)}`).join(", ")} RESTART IDENTITY CASCADE;`;
  await executeSqlCmdsAsIamUser(options, instanceId, databaseId, [truncateSql], true);

  const afterCounts = await executeSqlCmdsAsIamUser(options, instanceId, databaseId, [countQuery], true);
  console.log("Rows after cleanup:");
  console.table(afterCounts[0].rows);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
