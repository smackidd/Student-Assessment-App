/*
 * Apply a reviewed, mismatch-only assessment repair plan. This script never
 * exports the workspace: full JSON exists only in PostgreSQL transaction memory.
 *
 * Plan: { projectId, workspaceId: "main", expectedVersion, sourceHashes:
 *   { "absolute/workbook.xlsx": "sha256" }, patches: [{ studentId, key,
 *   beforeExists, before, after, sourceFile, sourceSheet, sourceCell }] }
 *
 * node scripts/repair-import-values.cjs --plan <json> --plan-sha256 <sha256>
 *   --project <project> --confirm-project <project> --check|--apply
 *   [--allow-production] [--temporary-admin]
 *
 * Both modes acquire the application's existing workspace lock. --check writes
 * inside a SQL transaction and rolls back; --apply commits. A per-cell rollback
 * record and a summary are exclusively created alongside the plan unless their
 * locations are supplied with --rollback-record and --result.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PRODUCTION_PROJECT = "student-assessment-2d869";
const TEST_PROJECT = "student-assessment-test";
const INSTANCE_ID = "student-assessment-db";
const DATABASE_ID = "student_assessment";
const LOCK_LIFETIME_MS = 10 * 60 * 1000;
const hashPattern = /^[a-f0-9]{64}$/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAssessmentValue(value) {
  return value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseArguments(argv) {
  const booleans = new Set(["--apply", "--check", "--allow-production", "--temporary-admin"]);
  const values = new Set(["--plan", "--plan-sha256", "--project", "--confirm-project", "--rollback-record", "--result"]);
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    assert(!Object.hasOwn(args, flag), `Duplicate argument: ${flag}`);
    assert(booleans.has(flag) || values.has(flag), `Unknown argument: ${flag}`);
    if (booleans.has(flag)) args[flag] = true;
    else {
      const value = argv[++index];
      assert(typeof value === "string" && value.length > 0 && !value.startsWith("--"), `Missing value for ${flag}`);
      args[flag] = value;
    }
  }
  assert(Boolean(args["--apply"]) !== Boolean(args["--check"]), "Choose exactly one of --apply or --check.");
  assert(args["--plan"], "A reviewed --plan file is required.");
  assert(hashPattern.test(args["--plan-sha256"] || ""), "The reviewed --plan-sha256 is required.");
  assert([PRODUCTION_PROJECT, TEST_PROJECT].includes(args["--project"]), "Explicit --project must be an approved Student Assessment project.");
  assert(args["--confirm-project"] === args["--project"], "--confirm-project must exactly match --project.");
  assert(args["--project"] !== PRODUCTION_PROJECT || args["--allow-production"], "Production requires --allow-production.");
  return args;
}

function validatePlan(plan, projectId) {
  assert(isRecord(plan) && plan.projectId === projectId, "Plan project does not match the explicit target.");
  assert(plan.workspaceId === "main", "Only workspace main is supported.");
  assert(typeof plan.expectedVersion === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(plan.expectedVersion), "Plan must include the exact updated_at::text version.");
  assert(Number.isFinite(Date.parse(plan.expectedVersion)), "Invalid workspace version.");
  assert(Array.isArray(plan.patches) && plan.patches.length > 0 && plan.patches.length <= 100000, "Plan must contain 1-100000 reviewed patches.");
  assert(isRecord(plan.sourceHashes) && Object.keys(plan.sourceHashes).length > 0, "Plan sourceHashes must map absolute filenames to SHA256 values.");
  for (const [sourceFile, hash] of Object.entries(plan.sourceHashes)) {
    assert(path.isAbsolute(sourceFile) && typeof hash === "string" && hashPattern.test(hash), "Invalid absolute source filename or source hash.");
  }
  const seen = new Set();
  for (const patch of plan.patches) {
    assert(isRecord(patch), "Each patch must be an object.");
    assert(typeof patch.studentId === "string" && patch.studentId.length > 0 && patch.studentId.length < 200 && !/[\u0000-\u001f]/.test(patch.studentId), "Invalid student ID.");
    assert(typeof patch.key === "string" && /^year_[a-z0-9_]+__grade_[a-z0-9_]+__.+$/.test(patch.key) && patch.key.length < 1500 && !/[\u0000-\u001f]/.test(patch.key), "Only scoped assessmentValues keys can be repaired.");
    assert(typeof patch.beforeExists === "boolean", "Each patch must state beforeExists.");
    assert(Object.hasOwn(patch, "before") && isAssessmentValue(patch.before), "Each patch must include a primitive before value, or null for an absent key.");
    assert(patch.beforeExists || patch.before === null, "Absent prior keys must use before:null.");
    assert(Object.hasOwn(patch, "after") && isAssessmentValue(patch.after), "Each patch must include a primitive after value.");
    assert(!patch.beforeExists || patch.before !== patch.after, "Repair plan contains a no-op patch.");
    assert(typeof patch.sourceFile === "string" && Object.hasOwn(plan.sourceHashes, patch.sourceFile), "Every patch must reference a hashed source file.");
    assert(typeof patch.sourceSheet === "string" && patch.sourceSheet.length > 0, "Every patch needs a source sheet.");
    assert(typeof patch.sourceCell === "string" && /^\$?[A-Z]+\$?[1-9][0-9]*$/i.test(patch.sourceCell), "Every patch needs a valid source cell address.");
    const identity = JSON.stringify([patch.studentId, patch.key]);
    assert(!seen.has(identity), "Repair plan contains duplicate student/key targets.");
    seen.add(identity);
  }
  return plan;
}

function loadReviewedPlan(args) {
  const planPath = path.resolve(args["--plan"]);
  const bytes = fs.readFileSync(planPath);
  const planHash = sha256(bytes);
  assert(planHash === args["--plan-sha256"].toLowerCase(), "Plan SHA256 does not match the reviewed file.");
  const plan = validatePlan(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")), args["--project"]);
  for (const [sourceFile, expectedHash] of Object.entries(plan.sourceHashes)) {
    assert(sha256(fs.readFileSync(sourceFile)) === expectedHash.toLowerCase(), `Source workbook changed after the repair plan was reviewed: ${sourceFile}`);
  }
  return { plan, planHash, planPath };
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  const json = JSON.stringify(value);
  let suffix = 0;
  let delimiter = "$repair_plan$";
  while (json.includes(delimiter)) delimiter = `$repair_plan_${++suffix}$`;
  return `${delimiter}${json}${delimiter}::jsonb`;
}

function buildRepairCommands(plan, mode, lockExpiresAt) {
  validatePlan(plan, plan.projectId);
  assert(mode === "apply" || mode === "check", "Invalid repair mode.");
  assert(Number.isFinite(Date.parse(lockExpiresAt)), "A valid workspace-lock expiry is required.");
  const patches = plan.patches.map(({ studentId, key, beforeExists, before, after }) => ({ studentId, key, beforeExists, before, after }));
  const body = `DECLARE
  patches jsonb := ${sqlJson(patches)};
  before_state jsonb;
  next_state jsonb;
  actual_state jsonb;
  masked_before jsonb;
  masked_after jsonb;
  current_version text;
  resulting_version text;
  write_count integer;
  repaired_count integer;
BEGIN
  SELECT state_json, updated_at::text INTO STRICT before_state, current_version
    FROM public.prototype_workspace_state WHERE id = 'main' FOR UPDATE;
  IF current_version IS DISTINCT FROM ${sqlLiteral(plan.expectedVersion)} THEN
    RAISE EXCEPTION 'REPAIR_STALE_WORKSPACE_VERSION';
  END IF;
  IF jsonb_typeof(before_state -> 'rows') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'REPAIR_INVALID_WORKSPACE_ROWS';
  END IF;
  CREATE TEMP TABLE import_repair_patches (
    student_id text NOT NULL, assessment_key text NOT NULL,
    before_exists boolean NOT NULL, before_value jsonb NOT NULL,
    after_value jsonb NOT NULL, PRIMARY KEY (student_id, assessment_key)
  ) ON COMMIT DROP;
  INSERT INTO import_repair_patches
    SELECT value ->> 'studentId', value ->> 'key', (value ->> 'beforeExists')::boolean,
      value -> 'before', value -> 'after' FROM jsonb_array_elements(patches);
  SELECT count(*)::integer INTO repaired_count FROM import_repair_patches;
  IF repaired_count <> ${patches.length} THEN
    RAISE EXCEPTION 'REPAIR_PATCH_COUNT_MISMATCH';
  END IF;
  CREATE TEMP TABLE import_repair_rows ON COMMIT DROP AS
    SELECT ordinality::integer AS row_number, value ->> 'id' AS student_id, value AS row_json
      FROM jsonb_array_elements(before_state -> 'rows') WITH ORDINALITY AS student(value, ordinality);
  IF EXISTS (
    SELECT target.student_id FROM (SELECT DISTINCT student_id FROM import_repair_patches) target
      LEFT JOIN import_repair_rows student ON student.student_id = target.student_id
      GROUP BY target.student_id HAVING count(student.row_number) <> 1
  ) THEN
    RAISE EXCEPTION 'REPAIR_MISSING_OR_DUPLICATE_STUDENT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM import_repair_patches patch JOIN import_repair_rows student USING (student_id)
      WHERE jsonb_typeof(student.row_json -> 'assessmentValues') IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION 'REPAIR_ASSESSMENT_VALUES_NOT_OBJECT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM import_repair_patches patch JOIN import_repair_rows student USING (student_id)
      WHERE ((student.row_json -> 'assessmentValues') ? patch.assessment_key) IS DISTINCT FROM patch.before_exists
  ) THEN
    RAISE EXCEPTION 'REPAIR_STALE_CELL_EXISTENCE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM import_repair_patches patch JOIN import_repair_rows student USING (student_id)
      WHERE patch.before_exists AND (student.row_json -> 'assessmentValues' -> patch.assessment_key) IS DISTINCT FROM patch.before_value
  ) THEN
    RAISE EXCEPTION 'REPAIR_STALE_CELL_VALUE';
  END IF;
  CREATE TEMP TABLE import_repair_grouped ON COMMIT DROP AS
    SELECT student_id, jsonb_object_agg(assessment_key, after_value) AS replacement_values,
      array_agg(assessment_key) AS target_keys FROM import_repair_patches GROUP BY student_id;
  CREATE TEMP TABLE import_repair_next_rows ON COMMIT DROP AS
    SELECT student.row_number, student.student_id, student.row_json AS before_row, repair.target_keys,
      CASE WHEN repair.student_id IS NULL THEN student.row_json
        ELSE jsonb_set(student.row_json, '{assessmentValues}',
          (student.row_json -> 'assessmentValues') || repair.replacement_values, false)
      END AS after_row
      FROM import_repair_rows student LEFT JOIN import_repair_grouped repair USING (student_id);
  next_state := jsonb_set(before_state, '{rows}',
    (SELECT jsonb_agg(after_row ORDER BY row_number) FROM import_repair_next_rows), false);
  masked_before := jsonb_set(before_state, '{rows}', (
    SELECT jsonb_agg(CASE WHEN target_keys IS NULL THEN before_row
      ELSE jsonb_set(before_row, '{assessmentValues}', (before_row -> 'assessmentValues') - target_keys, false)
      END ORDER BY row_number) FROM import_repair_next_rows
  ), false);
  masked_after := jsonb_set(next_state, '{rows}', (
    SELECT jsonb_agg(CASE WHEN target_keys IS NULL THEN after_row
      ELSE jsonb_set(after_row, '{assessmentValues}', (after_row -> 'assessmentValues') - target_keys, false)
      END ORDER BY row_number) FROM import_repair_next_rows
  ), false);
  IF (SELECT count(*) FROM import_repair_patches patch JOIN import_repair_next_rows student USING (student_id)
    WHERE (student.after_row -> 'assessmentValues' -> patch.assessment_key) IS NOT DISTINCT FROM patch.after_value
  ) <> repaired_count THEN
    RAISE EXCEPTION 'REPAIR_PROPOSED_VALUE_MISMATCH';
  END IF;
  IF masked_after IS DISTINCT FROM masked_before THEN
    RAISE EXCEPTION 'REPAIR_UNRELATED_STATE_CHANGED';
  END IF;
  IF clock_timestamp() >= ${sqlLiteral(lockExpiresAt)}::timestamptz - interval '90 seconds' THEN
    RAISE EXCEPTION 'REPAIR_WORKSPACE_LOCK_NEAR_EXPIRY';
  END IF;
  UPDATE public.prototype_workspace_state
    SET state_json = next_state, updated_at = clock_timestamp()
    WHERE id = 'main' AND updated_at::text = ${sqlLiteral(plan.expectedVersion)};
  GET DIAGNOSTICS write_count = ROW_COUNT;
  IF write_count <> 1 THEN
    RAISE EXCEPTION 'REPAIR_WORKSPACE_WRITE_COUNT_MISMATCH';
  END IF;
  SELECT state_json, updated_at::text INTO STRICT actual_state, resulting_version
    FROM public.prototype_workspace_state WHERE id = 'main';
  IF actual_state IS DISTINCT FROM next_state OR resulting_version = current_version THEN
    RAISE EXCEPTION 'REPAIR_IN_TRANSACTION_VERIFICATION_FAILED';
  END IF;
  INSERT INTO import_repair_summary VALUES (
    repaired_count, md5(before_state::text), md5(next_state::text),
    md5(masked_before::text), md5(masked_after::text), current_version, resulting_version
  );
END;`;
  let tag = "$repair_transaction$";
  let tagIndex = 0;
  while (body.includes(tag)) tag = `$repair_transaction_${++tagIndex}$`;
  const block = `DO ${tag}\n${body}\n${tag};`;
  return [
    "BEGIN;",
    "SET LOCAL lock_timeout = '15s';",
    "SET LOCAL statement_timeout = '90s';",
    "SET LOCAL idle_in_transaction_session_timeout = '90s';",
    "CREATE TEMP TABLE import_repair_summary (patched_cells integer, before_hash text, after_hash text, untouched_before_hash text, untouched_after_hash text, before_version text, after_version text) ON COMMIT DROP;",
    block,
    "SELECT * FROM import_repair_summary;",
    mode === "apply" ? "COMMIT;" : "ROLLBACK;"
  ];
}

function createFirestoreLockClient(firebaseRoot, projectId, testClient) {
  const client = testClient || new (require(path.join(firebaseRoot, "apiv2")).Client)({ urlPrefix: "https://firestore.googleapis.com", apiVersion: "v1" });
  const databasePath = `projects/${projectId}/databases/(default)`;
  const name = `${databasePath}/documents/organizations/student-assessment/workspaceLocks/main`;
  const options = { retries: 0, timeout: 30000, skipLog: { body: true, resBody: true } };
  async function read() {
    const result = await client.get(`/${name}`, { ...options, resolveOnHTTPError: true });
    if (result.status === 404) return null;
    assert(result.status === 200 && result.body?.updateTime, `Workspace lock read failed (HTTP ${result.status}).`);
    return result.body;
  }
  return {
    read,
    async acquire(owner, accountEmail) {
      const existing = await read();
      const now = Date.now();
      if (existing) {
        const expires = Date.parse(existing.fields?.expiresAt?.timestampValue || "");
        assert(Number.isFinite(expires), "Existing workspace lock has no valid expiry; it was left untouched.");
        assert(expires <= now, "An application workspace save is in progress; no repair was attempted.");
      }
      const expiresAt = new Date(now + LOCK_LIFETIME_MS).toISOString();
      const write = {
        update: { name, fields: {
          owner: { stringValue: owner }, uid: { stringValue: accountEmail },
          acquiredAt: { timestampValue: new Date(now).toISOString() },
          expiresAt: { timestampValue: expiresAt }
        } },
        currentDocument: existing ? { updateTime: existing.updateTime } : { exists: false }
      };
      // A timed-out commit may have succeeded. The caller's finally block checks
      // the unique owner and can safely remove only this invocation's lock.
      await client.post(`/${databasePath}/documents:commit`, { writes: [write] }, { ...options });
      const verified = await read();
      assert(verified?.fields?.owner?.stringValue === owner, "Workspace lock ownership could not be verified.");
      return expiresAt;
    },
    async release(owner) {
      const current = await read();
      if (!current || current.fields?.owner?.stringValue !== owner) return false;
      await client.post(`/${databasePath}/documents:commit`, {
        writes: [{ delete: name, currentDocument: { updateTime: current.updateTime } }]
      }, { ...options });
      return true;
    }
  };
}

function publicError(error) {
  const message = String(error?.message || "Unknown repair failure");
  const code = message.match(/REPAIR_[A-Z_]+/);
  return code ? code[0] : message.slice(0, 400);
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const { plan, planHash, planPath } = loadReviewedPlan(args);
  const mode = args["--apply"] ? "apply" : "check";
  const rollbackPath = path.resolve(args["--rollback-record"] || `${planPath}.${mode}.rollback.json`);
  const resultPath = path.resolve(args["--result"] || `${planPath}.${mode}.result.json`);
  assert(new Set([planPath, rollbackPath, resultPath]).size === 3, "Plan, rollback record, and result must use separate paths.");
  assert(!fs.existsSync(rollbackPath) && !fs.existsSync(resultPath), "Refusing to overwrite an earlier repair artifact. Supply fresh output paths.");
  assert(fs.statSync(path.dirname(rollbackPath)).isDirectory() && fs.statSync(path.dirname(resultPath)).isDirectory(), "Repair artifact directories must already exist.");
  const projectId = args["--project"];
  const accountEmail = process.env.FIREBASE_ACCOUNT || "stevemackidd@gmail.com";
  const firebaseRoot = path.join(process.env.APPDATA || "", "npm", "node_modules", "firebase-tools", "lib");
  const auth = require(path.join(firebaseRoot, "auth"));
  const account = auth.selectAccount(accountEmail, process.cwd());
  assert(account, "The selected Firebase CLI account is not logged in.");
  auth.setActiveAccount({ project: projectId, nonInteractive: true }, account);

  const summary = {
    projectId, workspaceId: plan.workspaceId, mode, planSha256: planHash,
    patchCount: plan.patches.length,
    studentCount: new Set(plan.patches.map((patch) => patch.studentId)).size,
    sourceFileCount: Object.keys(plan.sourceHashes).length,
    startedAt: new Date().toISOString(), status: "prepared"
  };
  fs.writeFileSync(rollbackPath, JSON.stringify({
    ...summary, expectedVersion: plan.expectedVersion,
    sourceHashes: plan.sourceHashes,
    patches: plan.patches,
    note: "Per-cell rollback evidence only. beforeExists:false means the original key must be removed when reversing. Do not restore the entire workspace."
  }, null, 2), { flag: "wx", mode: 0o600 });

  const lock = createFirestoreLockClient(firebaseRoot, projectId);
  const owner = `import-repair:${crypto.randomUUID()}`;
  let sql;
  let lockAttempted = false;
  let stage = "create-sql-session";
  let failure;
  try {
    const { createSqlSession } = require("./data-connect-sql-session.cjs");
    sql = await createSqlSession({ projectId, instanceId: INSTANCE_ID, databaseId: DATABASE_ID, accountEmail, temporaryAdmin: Boolean(args["--temporary-admin"]) });
    stage = "acquire-workspace-lock";
    lockAttempted = true;
    const expiresAt = await lock.acquire(owner, accountEmail);
    stage = "guarded-sql-transaction";
    summary.status = "transaction-requested";
    const result = await sql.run(buildRepairCommands(plan, mode, expiresAt));
    const transaction = result[6]?.rows?.[0];
    assert(transaction && Number(transaction.patched_cells) === plan.patches.length, "Repair transaction returned an unexpected patch count.");
    assert(transaction.untouched_before_hash === transaction.untouched_after_hash, "Repair transaction reported unrelated state changes.");
    summary.transaction = transaction;
    summary.status = mode === "apply" ? "committed-verification-pending" : "rolled-back-verification-pending";
    stage = "independent-post-verification";
    const postResult = await sql.run([
      "SELECT md5(state_json::text) AS state_hash, updated_at::text AS version FROM public.prototype_workspace_state WHERE id = 'main';"
    ]);
    const post = postResult[0]?.rows?.[0];
    const expectedHash = mode === "apply" ? transaction.after_hash : transaction.before_hash;
    const expectedVersion = mode === "apply" ? transaction.after_version : transaction.before_version;
    assert(post && post.state_hash === expectedHash && post.version === expectedVersion, "Post-transaction workspace verification failed; inspect the result record before any retry.");
    summary.status = mode === "apply" ? "applied-and-verified" : "verified-and-rolled-back";
    summary.verifiedVersion = post.version;
  } catch (error) {
    failure = error;
    summary.failureStage = stage;
    summary.error = publicError(error);
    if (stage === "guarded-sql-transaction") summary.status = "transaction-outcome-needs-verification";
    else if (summary.status === "prepared") summary.status = "not-applied";
  } finally {
    const cleanupErrors = [];
    if (lockAttempted) {
      try { summary.workspaceLockReleased = await lock.release(owner); }
      catch (error) { cleanupErrors.push(`Workspace lock cleanup: ${publicError(error)}`); }
    }
    if (sql) {
      try { await sql.close(); }
      catch (error) { cleanupErrors.push(`SQL session cleanup: ${publicError(error)}`); }
    }
    if (cleanupErrors.length) {
      summary.cleanupErrors = cleanupErrors;
      failure = failure || new Error("Repair cleanup needs attention; inspect the result record.");
    }
    summary.finishedAt = new Date().toISOString();
    fs.writeFileSync(resultPath, JSON.stringify(summary, null, 2), { flag: "wx", mode: 0o600 });
  }
  console.log(JSON.stringify({ ...summary, rollbackRecord: rollbackPath, resultRecord: resultPath }, null, 2));
  if (failure) throw new Error(`Repair stopped at ${summary.failureStage || "cleanup"}: ${publicError(failure)}`);
  return summary;
}

module.exports = { parseArguments, validatePlan, loadReviewedPlan, buildRepairCommands, createFirestoreLockClient, sha256, run };

if (require.main === module) {
  run().catch((error) => {
    console.error(publicError(error));
    process.exitCode = 1;
  });
}
