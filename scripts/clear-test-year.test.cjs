const { test } = require("node:test");
const assert = require("node:assert/strict");
const { planCleanup, commands, run } = require("./clear-test-year.cjs");
const key = "year_2025_2026__grade_4__score";
function fixture() {
  return { pendingStudentSync: false, schoolYears: ["2024-2025", "2025-2026"], templates: [{ id: "orf" }],
    rows: [{ id: "only", assessmentValues: { [key]: 7 } }, { id: "shared", assessmentValues: { [key]: 8, year_2024_2025__score: 9 } }],
    placements: [{ studentId: "only", schoolYear: "2025-2026" }, { studentId: "shared", schoolYear: "2025-2026" }, { studentId: "shared", schoolYear: "2024-2025" }],
    importLogs: [{ id: "target", schoolYear: "2025-2026", addedStudentIds: ["only"] }, { id: "keep", schoolYear: "2024-2025", addedStudentIds: ["shared"] }],
    auditEvents: [{ id: "remove", importLogId: "target" }, { id: "keep", description: "2024-2025" }] };
}
test("removes target-year scores and identities while preserving shared students and setup", () => {
  const state = fixture(); const original = structuredClone(state);
  const plan = planCleanup(state, [{ id: "uuid", student_number: "only" }, { id: "uuid2", student_number: "shared" }], [], []);
  assert.deepEqual(state, original);
  assert.equal(plan.counts.placements, 2); assert.equal(plan.counts.databaseStudents, 1);
  assert.deepEqual(plan.next.rows, [{ id: "shared", assessmentValues: { year_2024_2025__score: 9 } }]);
  assert.deepEqual(plan.next.templates, state.templates); assert.deepEqual(plan.next.schoolYears, state.schoolYears);
  assert.deepEqual(plan.next.importLogs, [state.importLogs[1]]); assert.deepEqual(plan.next.auditEvents, [state.auditEvents[1]]);
});
test("protects students referenced by another year's import history", () => {
  const state = fixture(); state.importLogs[1].addedStudentIds.push("only");
  assert.deepEqual(planCleanup(state, [], [], []).removedIds, []);
});
test("refuses cross-year snapshots and pending synchronization", () => {
  const state = fixture(); state.importLogs[1].addedRows = [{ assessmentValues: { [key]: 1 } }];
  assert.throws(() => planCleanup(state, [], [], []), /snapshot/);
  state.importLogs[1].addedRows = []; state.pendingStudentSync = true;
  assert.throws(() => planCleanup(state, [], [], []), /sync/);
});
test("protects students with scores in another year even without a placement", () => {
  const state = fixture(); state.rows[0].assessmentValues.year_2023_2024__score = 0;
  assert.deepEqual(planCleanup(state, [], [], []).removedIds, []);
});
test("SQL has version, lock, normalized-data and rehearsed-result guards", () => {
  const plan = planCleanup(fixture(), [], [], []);
  const sql = commands(plan, "version", "before", "2026-10-02", "apply", "after").join("\n");
  assert.match(sql, /FOR UPDATE/); assert.match(sql, /Workspace changed since inspection/);
  assert.match(sql, /Unexpected normalized data/); assert.match(sql, /Rehearsed result mismatch/);
  assert.match(sql, /COMMIT$/); assert.doesNotMatch(sql, /TRUNCATE|CASCADE/);
  assert.throws(() => commands(plan, "v", "b", "date", "apply"));
});
test("rejects production and other years before loading any cloud libraries", async () => {
  await assert.rejects(run(["--apply", "student-assessment-2d869:2025-2026"]));
  await assert.rejects(run(["--apply", "student-assessment-test:2024-2025"]));
});
