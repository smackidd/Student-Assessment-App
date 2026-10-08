const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Deliberately not a general-purpose purge or a production migration.
const PROJECT = "student-assessment-test";
const YEAR = "2025-2026";
const PREFIX = "year_2025_2026__";
const EMPTY_TABLES = ["student_enrollment", "assessment_session", "assessment_result",
  "assessment_result_value", "student_note", "generated_report", "spreadsheet_import",
  "spreadsheet_import_mapping", "assessment_file_link", "uploaded_file"];
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const json = (value) => quote(JSON.stringify(value)) + "::jsonb";
const list = (values) => values.length ? values.map(quote).join(",") : "NULL";
const parse = (value) => typeof value === "string" ? JSON.parse(value) : value;

function mentionsYear(value) {
  const text = JSON.stringify(value);
  return text.includes(YEAR) || text.includes(PREFIX);
}

function planCleanup(state, students, sqlAudit, firestoreDocs) {
  assert.equal(state.pendingStudentSync, false, "Pending student sync must finish first.");
  const targetLogs = state.importLogs.filter((log) => log.schoolYear === YEAR);
  const otherLogs = state.importLogs.filter((log) => log.schoolYear !== YEAR);
  assert(!otherLogs.some(mentionsYear), "Another year's import snapshot contains target-year data; review manually.");
  const targetLogIds = new Set(targetLogs.map((log) => log.id));
  const candidates = new Set([
    ...state.placements.filter((p) => p.schoolYear === YEAR).map((p) => p.studentId),
    ...state.rows.filter((row) => Object.keys(row.assessmentValues || {}).some((key) => key.startsWith(PREFIX))).map((row) => row.id),
    ...targetLogs.flatMap((log) => log.addedStudentIds || [])
  ]);
  const protectedIds = new Set([
    ...state.placements.filter((p) => p.schoolYear !== YEAR).map((p) => p.studentId),
    ...otherLogs.flatMap((log) => [...(log.addedStudentIds || []), ...(log.addedRows || []).map((row) => row.id),
      ...(log.updatedRows || []).map((row) => row.studentId), ...(log.addedPlacements || []).map((p) => p.studentId)]),
    ...state.rows.filter((row) => Object.entries(row.assessmentValues || {}).some(([key, value]) =>
      !key.startsWith(PREFIX) && value !== null && value !== "")).map((row) => row.id)
  ]);
  const removedIds = [...candidates].filter((id) => !protectedIds.has(id));
  const removed = new Set(removedIds);
  const studentRows = students.filter((student) => removed.has(student.student_number) || removed.has(student.id));
  const isTargetAudit = (event) => mentionsYear(event) || targetLogIds.has(event.importLogId) || targetLogIds.has(event.entity_id);
  const targetAudit = state.auditEvents.filter(isTargetAudit);
  const targetSqlAudit = sqlAudit.filter(isTargetAudit);
  const targetFirestore = firestoreDocs.filter((doc) => isTargetAudit({ ...doc.fields,
    importLogId: doc.fields?.importLogId?.stringValue }));
  const next = structuredClone(state);
  next.rows = next.rows.filter((row) => !removed.has(row.id)).map((row) => ({ ...row,
    ...(row.assessmentValues ? { assessmentValues: Object.fromEntries(Object.entries(row.assessmentValues)
      .filter(([key]) => !key.startsWith(PREFIX))) } : {}) }));
  next.placements = next.placements.filter((p) => p.schoolYear !== YEAR);
  next.importLogs = otherLogs;
  next.auditEvents = next.auditEvents.filter((event) => !isTargetAudit(event));
  assert(!next.rows.some((row) => Object.keys(row.assessmentValues || {}).some((key) => key.startsWith(PREFIX))));
  assert(!next.importLogs.some(mentionsYear));
  const counts = {
    placements: state.placements.length - next.placements.length,
    assessmentEntries: state.rows.reduce((count, row) => count + Object.keys(row.assessmentValues || {}).filter((key) => key.startsWith(PREFIX)).length, 0),
    workspaceStudents: state.rows.length - next.rows.length,
    databaseStudents: studentRows.length,
    importLogs: targetLogs.length,
    workspaceAuditEvents: targetAudit.length,
    databaseAuditEvents: targetSqlAudit.length,
    firestoreAuditEvents: targetFirestore.length
  };
  return { next, removedIds, studentRows, targetLogs, targetAudit, targetSqlAudit, targetFirestore, counts };
}

function commands(plan, version, beforeHash, expiresAt, mode, expectedAfterHash) {
  assert(["check", "apply"].includes(mode));
  assert(mode !== "apply" || expectedAfterHash);
  return ["BEGIN", "SET LOCAL lock_timeout = '15s'", "SET LOCAL statement_timeout = '90s'",
    "SET LOCAL idle_in_transaction_session_timeout = '90s'",
    `LOCK TABLE public.student, public.audit_event, ${EMPTY_TABLES.map((name) => "public." + name).join(",")} IN SHARE ROW EXCLUSIVE MODE`,
    `DO $cleanup$
DECLARE before_state jsonb; next_state jsonb; current_version text; deleted_count int;
BEGIN
 IF current_database() <> 'student_assessment' THEN RAISE EXCEPTION 'Wrong database'; END IF;
 IF clock_timestamp() > ${quote(expiresAt)}::timestamptz - interval '60 seconds' THEN RAISE EXCEPTION 'Workspace lock expired'; END IF;
 SELECT state_json, updated_at::text INTO STRICT before_state, current_version FROM public.prototype_workspace_state WHERE id='main' FOR UPDATE;
 IF current_version <> ${quote(version)} OR md5(before_state::text) <> ${quote(beforeHash)} THEN RAISE EXCEPTION 'Workspace changed since inspection'; END IF;
 ${EMPTY_TABLES.map((name) => `IF EXISTS(SELECT 1 FROM public.${name}) THEN RAISE EXCEPTION 'Unexpected normalized data in ${name}; review before cleanup'; END IF;`).join("\n")}
 next_state := before_state || jsonb_build_object(
  'rows', (SELECT coalesce(jsonb_agg(CASE WHEN item ? 'assessmentValues' THEN jsonb_set(item, '{assessmentValues}',
    (SELECT coalesce(jsonb_object_agg(key,value), '{}'::jsonb) FROM jsonb_each(item->'assessmentValues') WHERE left(key,${PREFIX.length}) <> ${quote(PREFIX)})) ELSE item END ORDER BY n), '[]'::jsonb)
    FROM jsonb_array_elements(before_state->'rows') WITH ORDINALITY AS rows(item,n) WHERE NOT (${json(plan.removedIds)} ? (item->>'id'))),
  'placements', (SELECT coalesce(jsonb_agg(item ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(before_state->'placements') WITH ORDINALITY AS p(item,n) WHERE item->>'schoolYear' <> ${quote(YEAR)}),
  'importLogs', (SELECT coalesce(jsonb_agg(item ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(before_state->'importLogs') WITH ORDINALITY AS p(item,n) WHERE NOT (${json(plan.targetLogs.map((x) => x.id))} ? (item->>'id'))),
  'auditEvents', (SELECT coalesce(jsonb_agg(item ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(before_state->'auditEvents') WITH ORDINALITY AS p(item,n) WHERE NOT (${json(plan.targetAudit.map((x) => x.id))} ? (item->>'id')))
 );
 ${expectedAfterHash ? `IF md5(next_state::text) <> ${quote(expectedAfterHash)} THEN RAISE EXCEPTION 'Rehearsed result mismatch'; END IF;` : ""}
 DELETE FROM public.student WHERE id::text IN (${list(plan.studentRows.map((s) => s.id))});
 GET DIAGNOSTICS deleted_count = ROW_COUNT;
 IF deleted_count <> ${plan.studentRows.length} THEN RAISE EXCEPTION 'Unexpected student delete count'; END IF;
 DELETE FROM public.audit_event WHERE id::text IN (${list(plan.targetSqlAudit.map((s) => s.id))});
 GET DIAGNOSTICS deleted_count = ROW_COUNT;
 IF deleted_count <> ${plan.targetSqlAudit.length} THEN RAISE EXCEPTION 'Unexpected audit delete count'; END IF;
 UPDATE public.prototype_workspace_state SET state_json=next_state, updated_at=clock_timestamp() WHERE id='main';
END $cleanup$`,
    "SELECT state_json,md5(state_json::text) AS state_hash,updated_at::text AS version FROM public.prototype_workspace_state WHERE id='main'",
    mode === "apply" ? "COMMIT" : "ROLLBACK"];
}

function writeProtectedBackup(data) {
  const directory = path.join(process.env.LOCALAPPDATA, "Codex", PROJECT, "year-cleanups", new Date().toISOString().replaceAll(":", "-"));
  fs.mkdirSync(directory, { recursive: true });
  const protectedBytes = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $scope=[Security.Cryptography.DataProtectionScope]::CurrentUser; $encrypted=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,$scope); $verified=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,$scope); if([Convert]::ToBase64String($bytes) -cne [Convert]::ToBase64String($verified)){throw 'Recovery copy verification failed'}; [Console]::Out.Write([Convert]::ToBase64String($encrypted))"],
  { input: Buffer.from(JSON.stringify(data)).toString("base64"), encoding: "utf8", maxBuffer: 100 * 1024 * 1024, windowsHide: true });
  assert.equal(protectedBytes.status, 0, "Encrypted recovery copy failed; no cleanup attempted.");
  const file = path.join(directory, "before-cleanup.dpapi");
  fs.writeFileSync(file, Buffer.from(protectedBytes.stdout.trim(), "base64"), { flag: "wx" });
  assert(fs.statSync(file).size > 0);
  return file;
}

async function run(args = process.argv.slice(2)) {
  assert.equal(args.length, 2, "Use --check or --apply followed by student-assessment-test:2025-2026");
  assert(["--check", "--apply"].includes(args[0]));
  assert.equal(args[1], `${PROJECT}:${YEAR}`, "This script cannot run against production or another year.");
  const mode = args[0].slice(2);
  const { createSqlSession } = require("./data-connect-sql-session.cjs");
  const { createFirestoreLockClient } = require("./repair-import-values.cjs");
  const firebaseRoot = path.join(process.env.APPDATA, "npm/node_modules/firebase-tools/lib");
  const { Client } = require(path.join(firebaseRoot, "apiv2"));
  const firestore = new Client({ urlPrefix: "https://firestore.googleapis.com", apiVersion: "v1" });
  const db = `projects/${PROJECT}/databases/(default)`;
  const auditPath = `${db}/documents/organizations/student-assessment/auditEvents`;
  const options = { retries: 0, timeout: 30000, skipLog: { body: true, resBody: true } };
  async function auditDocuments() {
    const documents = []; let token;
    do {
      const r = await firestore.get(`/${auditPath}`, { ...options, queryParams: { pageSize: 300, ...(token ? { pageToken: token } : {}) } });
      documents.push(...(r.body.documents || [])); token = r.body.nextPageToken;
    } while (token);
    return documents;
  }
  const sql = await createSqlSession({ projectId: PROJECT, instanceId: "student-assessment-db", databaseId: "student_assessment",
    accountEmail: "stevemackidd@gmail.com", temporaryAdmin: true });
  const lock = createFirestoreLockClient(firebaseRoot, PROJECT);
  const owner = `year-cleanup:${crypto.randomUUID()}`;
  let attemptedLock = false;
  const evidence = { project: PROJECT, year: YEAR, mode, status: "not-applied" };
  try {
    attemptedLock = true;
    const expiresAt = await lock.acquire(owner, "stevemackidd@gmail.com");
    const tableResult = await sql.run(["SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"]);
    const untouchedTables = tableResult[0].rows.map((t) => t.tablename).filter((name) => !["prototype_workspace_state", "student", "audit_event"].includes(name));
    assert(untouchedTables.every((name) => /^[a-z_]+$/.test(name)));
    const tableHashesSql = untouchedTables.map((name) => `SELECT ${quote(name)} AS name, count(*)::text AS count, md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash FROM public.${name} t`).join(" UNION ALL ");
    const readCommands = ["SELECT state_json,md5(state_json::text) AS state_hash,updated_at::text AS version FROM public.prototype_workspace_state WHERE id='main'",
      "SELECT * FROM public.student ORDER BY id", "SELECT * FROM public.audit_event ORDER BY id", tableHashesSql];
    const before = await sql.run(readCommands);
    assert.equal(before[0].rows.length, 1);
    const source = before[0].rows[0];
    const state = parse(source.state_json);
    const docs = await auditDocuments();
    const plan = planCleanup(state, before[1].rows, before[2].rows, docs);
    evidence.removed = plan.counts;
    evidence.beforeVersion = source.version;
    evidence.beforeHash = source.state_hash;
    console.log(JSON.stringify({ ...evidence, stage: "planned" }));
    const rehearsal = await sql.run(commands(plan, source.version, source.state_hash, expiresAt, "check"));
    const rehearsed = rehearsal[6].rows[0];
    assert.deepEqual(parse(rehearsed.state_json), plan.next, "SQL rehearsal differs from independently built cleanup plan.");
    const rolledBack = await sql.run(readCommands);
    assert.deepEqual(rolledBack, before, "Rollback did not restore the original database.");
    evidence.afterHash = rehearsed.state_hash;
    evidence.status = "rehearsed-and-rolled-back";
    if (mode === "apply") {
      evidence.recoveryFile = writeProtectedBackup({ project: PROJECT, year: YEAR, capturedAt: new Date().toISOString(),
        workspace: source, students: plan.studentRows, auditEvents: plan.targetSqlAudit, firestore: plan.targetFirestore,
        untouchedTableFingerprints: before[3].rows });
      assert((await lock.read())?.fields?.owner?.stringValue === owner, "Lost workspace lock.");
      evidence.status = "commit-requested";
      const result = await sql.run(commands(plan, source.version, source.state_hash, expiresAt, "apply", rehearsed.state_hash));
      assert.equal(result[6].rows[0].state_hash, rehearsed.state_hash);
      evidence.status = "sql-committed";
      assert(plan.targetFirestore.length < 450);
      if (plan.targetFirestore.length) {
        await firestore.post(`/${db}/documents:commit`, { writes: plan.targetFirestore.map((doc) => ({
          delete: doc.name, currentDocument: { updateTime: doc.updateTime }
        })) }, options);
      }
      evidence.status = "sql-and-firestore-committed";
      const after = await sql.run(readCommands);
      assert.deepEqual(parse(after[0].rows[0].state_json), plan.next, "Workspace verification failed.");
      assert.deepEqual(after[1].rows, before[1].rows.filter((s) => !plan.studentRows.some((d) => d.id === s.id)), "Student identity verification failed.");
      assert.deepEqual(after[2].rows, before[2].rows.filter((s) => !plan.targetSqlAudit.some((d) => d.id === s.id)), "SQL audit verification failed.");
      assert.deepEqual(after[3].rows, before[3].rows, "An unrelated normalized table changed.");
      const remainingDocs = await auditDocuments();
      const expectedDocs = docs.filter((doc) => !plan.targetFirestore.some((d) => d.name === doc.name));
      const sortDocs = (values) => values.toSorted((a, b) => a.name.localeCompare(b.name));
      assert.deepEqual(sortDocs(remainingDocs), sortDocs(expectedDocs), "Audit verification mismatch.");
      evidence.status = "applied-and-verified";
      evidence.afterVersion = after[0].rows[0].version;
      evidence.remainingPlacementsByYear = plan.next.placements.reduce((a, p) => { a[p.schoolYear] = (a[p.schoolYear] || 0) + 1; return a; }, {});
    }
  } catch (error) {
    // Avoid assertion dumps that may contain student records or SQL payloads.
    evidence.failureType = error.name;
    evidence.failureCode = error.code;
    throw error;
  } finally {
    try { if (attemptedLock) evidence.lockReleased = await lock.release(owner); }
    finally { await sql.close(); }
    if (evidence.recoveryFile) fs.writeFileSync(path.join(path.dirname(evidence.recoveryFile), "result.json"), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  }
}

module.exports = { planCleanup, commands, run };
if (require.main === module) run().catch(() => { console.error("Cleanup stopped. Review its last status; no automatic retry or production operation was attempted."); process.exitCode = 1; });
