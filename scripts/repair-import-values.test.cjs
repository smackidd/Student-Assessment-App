const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  parseArguments,
  validatePlan,
  buildRepairCommands,
  createFirestoreLockClient
} = require("./repair-import-values.cjs");

const project = "student-assessment-2d869";
const sourceFile = path.resolve("synthetic-import-fixture.xlsx");
function plan() {
  return {
    projectId: project,
    workspaceId: "main",
    expectedVersion: "2026-09-25 19:00:00.123456+00",
    sourceHashes: { [sourceFile]: "a".repeat(64) },
    patches: [{
      studentId: "synthetic-student", key: "year_2024_2025__grade_3__orf_orf__fall_fall__passage_1_p1__wpm_wpm",
      beforeExists: true, before: 61, after: 65,
      sourceFile, sourceSheet: "Overview", sourceCell: "C5"
    }]
  };
}

function args() {
  return ["--plan", "plan.json", "--plan-sha256", "b".repeat(64), "--project", project,
    "--confirm-project", project, "--allow-production", "--check"];
}

test("explicit project, reviewed hash and production confirmation are mandatory", () => {
  assert.equal(parseArguments(args())["--check"], true);
  assert.throws(() => parseArguments(args().filter((value) => value !== "--allow-production")), /allow-production/);
  assert.throws(() => parseArguments([...args(), "--apply"]), /exactly one/);
  assert.throws(() => parseArguments([...args(), "--check"]), /Duplicate/);
  assert.throws(() => parseArguments([...args(), "--unsafe"]), /Unknown/);
  const wrongConfirmation = args();
  wrongConfirmation[wrongConfirmation.indexOf("--confirm-project") + 1] = "student-assessment-test";
  assert.throws(() => parseArguments(wrongConfirmation), /confirm-project/);
});

test("plans reject wrong workspace, duplicate cells, unscoped keys and untracked sources", () => {
  assert.equal(validatePlan(plan(), project).patches.length, 1);
  assert.throws(() => validatePlan(plan(), "student-assessment-test"), /project/);
  assert.throws(() => validatePlan({ ...plan(), workspaceId: "other" }, project), /workspace main/);
  const duplicate = plan();
  duplicate.patches.push({ ...duplicate.patches[0] });
  assert.throws(() => validatePlan(duplicate, project), /duplicate/);
  const unscoped = plan();
  unscoped.patches[0].key = "septP1Wpm";
  assert.throws(() => validatePlan(unscoped, project), /scoped/);
  const untracked = plan();
  untracked.patches[0].sourceFile = "unknown.xlsx";
  assert.throws(() => validatePlan(untracked, project), /hashed source/);
});

test("absent values, null, no-op and invalid primitive guards distinguish cell states", () => {
  const missing = plan();
  missing.patches[0].beforeExists = false;
  assert.throws(() => validatePlan(missing, project), /before:null/);
  missing.patches[0].before = null;
  assert.doesNotThrow(() => validatePlan(missing, project));
  const noOp = plan();
  noOp.patches[0].after = noOp.patches[0].before;
  assert.throws(() => validatePlan(noOp, project), /no-op/);
  noOp.patches[0].after = { score: 65 };
  assert.throws(() => validatePlan(noOp, project), /primitive after/);
  const badVersion = plan();
  badVersion.expectedVersion += "'; SELECT 1;";
  assert.throws(() => validatePlan(badVersion, project), /updated_at/);
});

test("SQL guards and verifies every patch before the commit/rollback command", () => {
  const check = buildRepairCommands(plan(), "check", "2026-09-25T19:10:00.000Z");
  const apply = buildRepairCommands(plan(), "apply", "2026-09-25T19:10:00.000Z");
  assert.equal(check.at(-1), "ROLLBACK;");
  assert.equal(apply.at(-1), "COMMIT;");
  for (const code of ["REPAIR_STALE_WORKSPACE_VERSION", "REPAIR_MISSING_OR_DUPLICATE_STUDENT", "REPAIR_STALE_CELL_EXISTENCE", "REPAIR_STALE_CELL_VALUE", "REPAIR_UNRELATED_STATE_CHANGED", "REPAIR_WORKSPACE_LOCK_NEAR_EXPIRY", "REPAIR_IN_TRANSACTION_VERIFICATION_FAILED"]) {
    assert.ok(check[5].includes(code), code);
  }
  assert.ok(check[5].includes("FOR UPDATE"));
  assert.ok(check[5].includes("updated_at = clock_timestamp()"));
  assert.equal(check[6], "SELECT * FROM import_repair_summary;");
  assert.ok(!check.some((sql) => /SELECT\s+state_json\s+FROM/i.test(sql)));
});

test("SQL dollar-quoted delimiters cannot be terminated by assessment text", () => {
  const hostile = plan();
  hostile.patches[0].after = "$repair_transaction$ $repair_transaction_1$ $repair_plan$ '$value'";
  const sql = buildRepairCommands(hostile, "check", "2026-09-25T19:10:00.000Z")[5];
  assert.ok(sql.startsWith("DO $repair_transaction_2$"));
  assert.ok(sql.includes("$repair_plan_1$"));
  assert.ok(sql.endsWith("$repair_transaction_2$;"));
});

function fakeClient(doc = null) {
  const state = { doc, writes: [] };
  return {
    state,
    async get(_url, options) {
      assert.equal(options.body, undefined, "Firebase Client mutates request options; a previous POST body must not reach GET.");
      return state.doc ? { status: 200, body: state.doc } : { status: 404 };
    },
    async post(_url, body, options) {
      Object.assign(options, { method: "POST", body });
      const write = body.writes[0];
      state.writes.push(write);
      if (write.update) state.doc = { ...write.update, updateTime: "2026-09-25T19:00:01.123456Z" };
      if (write.delete) state.doc = null;
      return { status: 200, body: { writeResults: [{}] } };
    }
  };
}

test("workspace lock creates with an absence precondition and deletes only matching owner/version", async () => {
  const api = fakeClient();
  const lock = createFirestoreLockClient("unused", project, api);
  await lock.acquire("repair-owner", "synthetic@example.invalid");
  assert.deepEqual(api.state.writes[0].currentDocument, { exists: false });
  assert.equal(await lock.release("another-owner"), false);
  assert.equal(api.state.writes.length, 1);
  assert.equal(await lock.release("repair-owner"), true);
  assert.deepEqual(api.state.writes[1].currentDocument, { updateTime: "2026-09-25T19:00:01.123456Z" });
});

test("active/malformed locks are untouched; expired lock acquisition uses updateTime CAS", async () => {
  const current = fakeClient({ updateTime: "v1", fields: { expiresAt: { timestampValue: new Date(Date.now() + 60000).toISOString() } } });
  await assert.rejects(createFirestoreLockClient("unused", project, current).acquire("repair-owner", "test"), /in progress/);
  assert.equal(current.state.writes.length, 0);
  const malformed = fakeClient({ updateTime: "v1", fields: {} });
  await assert.rejects(createFirestoreLockClient("unused", project, malformed).acquire("repair-owner", "test"), /no valid expiry/);
  assert.equal(malformed.state.writes.length, 0);
  const expired = fakeClient({ updateTime: "v1", fields: { expiresAt: { timestampValue: "2020-01-01T00:00:00Z" } } });
  await createFirestoreLockClient("unused", project, expired).acquire("repair-owner", "test");
  assert.deepEqual(expired.state.writes[0].currentDocument, { updateTime: "v1" });
});
