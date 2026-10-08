const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { PROJECT, PRIVATE_ROOT, PLAN_LIFETIME_MS, parseArguments, accountSnapshot, stableSnapshot,
  buildPlan, summarize, assertProviderReady, privatePath, loadReviewedPlan, sha256, applyReviewedPlan, run } = require("./migrate-test-google-sso.cjs");
const exception = "owner@gmail.com";
function user(uid, email, role = "teacher_ea", extra = {}) {
  return { uid, email, emailVerified: true, disabled: false, displayName: uid,
    customClaims: { organizationId: "student-assessment", role, grade: "4", homeroom: "A", extraClaim: { preserve: 7 } },
    providerData: [{ providerId: "password", uid: email, email }], metadata: { creationTime: "2026-01-01T00:00:00Z", lastSignInTime: null },
    tokensValidAfterTime: "2026-01-01T00:00:00Z", passwordHash: "never-back-up-this", passwordSalt: "never-back-up-this", ...extra };
}
function fixture() {
  return [user("staff", " Staff@FoothillsAcademy.org "), user("owner", exception, "admin"),
    user("outside", "other@gmail.com"), user("near", "other@sub.foothillsacademy.org"),
    user("invalid", "invalid@foothillsacademy.org", "owner"),
    user("other-org", "staff2@foothillsacademy.org", "admin", { customClaims: { organizationId: "another", role: "admin" } })];
}
const ready = () => ({ config: { signIn: { allowDuplicateEmails: false }, blockingFunctions: { triggers: {
  beforeCreate: { functionUri: "https://test-before-create.example" }, beforeSignIn: { functionUri: "https://test-before-signin.example" } } } }, google: { enabled: true } });
function fakeAuth(source) {
  const users = structuredClone(source); const events = [];
  const find = (uid) => users.find((candidate) => candidate.uid === uid);
  return { users, events, async listUsers() { events.push("list"); return { users: structuredClone(users) }; },
    async getUser(uid) { events.push(`get:${uid}`); return structuredClone(find(uid)); },
    async setCustomUserClaims(uid, claims) { events.push(`claims:${uid}`); find(uid).customClaims = structuredClone(claims); },
    async revokeRefreshTokens(uid) { events.push(`revoke:${uid}`); find(uid).tokensValidAfterTime = new Date().toISOString(); } };
}
const apply = (plan, auth, overrides = {}) => applyReviewedPlan(plan, { auth, providerConfig: ready(),
  backup: async (data) => { auth.events.push("backup"); assert.equal(data.project, PROJECT); },
  record: async (event) => { auth.events.push(event.stage); }, ...overrides });

test("dry-run is default and only exact Test project can reach client initialization", async () => {
  assert.equal(parseArguments(["--project", PROJECT]).mode, "dry-run");
  for (const project of ["production", "test", "student-assessment-2d869", "student-assessment-test-extra"]) {
    await assert.rejects(run(["--project", project]), /student-assessment-test/);
  }
});
test("argument guards reject ambiguous exceptions and unreviewed apply", () => {
  for (const email of ["*@gmail.com", "first@gmail.com,second@gmail.com", "staff@foothillsacademy.org", "owner@gmail.com other@gmail.com"]) {
    assert.throws(() => parseArguments(["--project", PROJECT, "--external-email", email]));
  }
  assert.throws(() => parseArguments(["--project", PROJECT, "--apply"]), /confirm-project/);
  assert.throws(() => parseArguments(["--project", PROJECT, "--apply", "--confirm-project", PROJECT]), /reviewed/);
  assert.throws(() => parseArguments(["--project", PROJECT, "--project", PROJECT]), /Duplicate/);
  assert.throws(() => parseArguments(["--project", PROJECT, "--dry-run", "--apply"]), /mode/);
  assert.throws(() => parseArguments(["--project", PROJECT, "--unknown"]), /Unknown/);
  assert.equal(parseArguments(["--project", PROJECT, "--external-email", " OWNER@GMAIL.COM "]).externalEmail, exception);
});
test("plan selects exact school and external identities, never granting membership", () => {
  const users = fixture(); const before = structuredClone(users); const plan = buildPlan(users, exception);
  assert.deepEqual(users, before);
  assert.deepEqual(plan.targets.map((item) => item.before.uid), ["owner", "staff"]);
  assert.deepEqual(plan.targets.find((item) => item.before.uid === "staff").afterClaims, {
    ...users[0].customClaims, authMethod: "google", invitedEmail: "staff@foothillsacademy.org" });
  assert.deepEqual(plan.excluded.map((item) => item.reason).sort(), ["invalid-role", "outside-allowlist", "outside-allowlist"]);
  assert.equal(summarize(plan).organizationMembers, 5);
  assert.equal(summarize(plan).externalExceptionIncluded, true);
});
test("no external option means no outsiders qualify, including a previously marked outsider", () => {
  const users = fixture(); users[1].customClaims.authMethod = "google"; users[1].customClaims.invitedEmail = exception;
  assert.deepEqual(buildPlan(users).targets.map((item) => item.before.uid), ["staff"]);
});
test("existing roles, custom claims, classroom scope and disabled state are preserved", () => {
  const users = fixture(); users[0].disabled = true; const plan = buildPlan(users, exception);
  const staff = plan.targets.find((target) => target.before.uid === "staff");
  assert.equal(staff.before.disabled, true);
  for (const key of ["organizationId", "role", "grade", "homeroom", "extraClaim"]) assert.deepEqual(staff.afterClaims[key], users[0].customClaims[key]);
  assert.equal(summarize(plan).enabledEligibleAdmins, 1);
});
test("already marked eligible accounts still receive refresh-token revocation", () => {
  const users = fixture(); users[1].customClaims = { ...users[1].customClaims, authMethod: "google", invitedEmail: exception };
  const summary = summarize(buildPlan(users, exception));
  assert.equal(summary.claimsToUpdate, 1); assert.equal(summary.refreshTokensToRevoke, 2);
});
test("oversized claims, duplicate identities and tenants cannot be silently migrated", () => {
  const large = user("large", "large@foothillsacademy.org", "admin"); large.customClaims.extraClaim = "x".repeat(950);
  assert.throws(() => buildPlan([large]), /size/);
  assert.throws(() => buildPlan([fixture()[0], fixture()[0]]), /Duplicate/);
  assert.equal(buildPlan([user("tenant", "staff@foothillsacademy.org", "admin", { tenantId: "elsewhere" })]).excluded[0].reason, "tenant-account");
});
test("backup snapshots omit password material and preserve account metadata", () => {
  const snapshot = accountSnapshot(fixture()[0]);
  assert.equal(snapshot.metadata.creationTime, "2026-01-01T00:00:00Z");
  assert.equal(snapshot.passwordHash, undefined); assert.equal(snapshot.passwordSalt, undefined);
});
test("provider preflight requires Google, one-account-per-email and both blocking triggers", () => {
  const config = ready(); assert.doesNotThrow(() => assertProviderReady(config.config, config.google));
  config.config.signIn = {}; assert.doesNotThrow(() => assertProviderReady(config.config, config.google));
  config.config.signIn.allowDuplicateEmails = true; assert.throws(() => assertProviderReady(config.config, config.google), /link/);
  config.config.signIn.allowDuplicateEmails = false; config.google.enabled = false;
  assert.throws(() => assertProviderReady(config.config, config.google), /enabled/);
  config.google.enabled = true; delete config.config.blockingFunctions.triggers.beforeCreate;
  assert.throws(() => assertProviderReady(config.config, config.google), /beforeCreate/);
});
test("private paths reject traversal, sibling prefix confusion and paths outside ignored root", () => {
  assert.equal(privatePath(path.join(PRIVATE_ROOT, "local", "plan.json")), path.join(PRIVATE_ROOT, "local", "plan.json"));
  assert.throws(() => privatePath(path.join(PRIVATE_ROOT, "../outside.json")), /ignored/);
  assert.throws(() => privatePath(`${PRIVATE_ROOT}-other/plan.json`), /ignored/);
  assert.throws(() => privatePath(PRIVATE_ROOT), /ignored/);
});
function withPlan(plan, callback) {
  const directory = path.join(PRIVATE_ROOT, `offline-test-${crypto.randomUUID()}`); fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "plan.json");
  const write = (value) => { const bytes = Buffer.from(JSON.stringify(value)); fs.writeFileSync(file, bytes); return sha256(bytes); };
  let hash = write(plan);
  const args = { project: PROJECT, externalEmail: exception, planFile: file, confirmedPlan: hash };
  try { return callback(args, (value) => { args.confirmedPlan = write(value); }); }
  finally { fs.unlinkSync(file); fs.rmdirSync(directory); }
}
test("reviewed plan validates hash, Test target, expiry, exact exception and unchanged roles", () => {
  const plan = buildPlan(fixture(), exception);
  withPlan(plan, (args, rewrite) => {
    assert.deepEqual(loadReviewedPlan(args), plan);
    assert.throws(() => loadReviewedPlan({ ...args, confirmedPlan: "0".repeat(64) }), /changed/);
    assert.throws(() => loadReviewedPlan({ ...args, externalEmail: "another@gmail.com" }), /exception/);
    assert.throws(() => loadReviewedPlan(args, Date.parse(plan.capturedAt) + PLAN_LIFETIME_MS + 1), /expired/);
    assert.throws(() => loadReviewedPlan(args, Date.parse(plan.capturedAt) - 1), /expired/);
    const promoted = structuredClone(plan); promoted.targets[1].afterClaims.role = "admin"; rewrite(promoted);
    assert.throws(() => loadReviewedPlan(args), /only add/);
    const production = { ...plan, project: "student-assessment-2d869" }; rewrite(production);
    assert.throws(() => loadReviewedPlan(args), /student-assessment-test/);
  });
});
test("apply backs up before any mutation, preserves UID and credentials, and verifies exclusions", async () => {
  const source = fixture(); const auth = fakeAuth(source); const journal = []; let backup;
  const result = await apply(buildPlan(source, exception), auth, { backup: async (data) => { backup = data; auth.events.push("backup"); },
    record: async (event) => journal.push(event) });
  assert.equal(result.status, "applied-and-verified");
  assert(auth.events.indexOf("backup") < auth.events.indexOf("claims:owner"));
  assert.equal(journal.filter((item) => item.stage === "verified").length, 2);
  assert.deepEqual(auth.users.map((item) => item.uid), source.map((item) => item.uid));
  for (const current of auth.users) {
    const original = source.find((item) => item.uid === current.uid);
    assert.equal(current.passwordHash, original.passwordHash); assert.deepEqual(current.providerData, original.providerData);
    assert.equal(current.disabled, original.disabled); assert.equal(current.customClaims.role, original.customClaims.role);
  }
  assert.equal(backup.members.find((item) => item.uid === "owner").customClaims.authMethod, undefined);
  assert.equal(backup.members[0].passwordHash, undefined);
  assert.deepEqual(auth.users.find((item) => item.uid === "outside"), source.find((item) => item.uid === "outside"));
});
test("provider not ready and no eligible Admin cause zero remote mutations or backups", async () => {
  const source = fixture(); const auth = fakeAuth(source); const config = ready(); config.google.enabled = false;
  await assert.rejects(apply(buildPlan(source, exception), auth, { providerConfig: config }), /enabled/);
  assert.deepEqual(auth.events, []);
  await assert.rejects(apply(buildPlan(source), auth), /existing enabled eligible Admin/);
  assert.deepEqual(auth.events, []);
});
test("changed claims and newly invited members invalidate review before backup or mutation", async () => {
  const source = fixture(); const plan = buildPlan(source, exception); const auth = fakeAuth(source);
  auth.users[0].customClaims.homeroom = "B"; await assert.rejects(apply(plan, auth), /changed since/);
  assert.deepEqual(auth.events, ["list"]);
  const invited = fakeAuth([...source, user("new", "new@foothillsacademy.org")]);
  await assert.rejects(apply(plan, invited), /changed since/);
  assert.deepEqual(invited.events, ["list"]);
});
test("backup failure prevents all remote mutations", async () => {
  const source = fixture(); const auth = fakeAuth(source);
  await assert.rejects(apply(buildPlan(source, exception), auth, { backup: async () => { throw new Error("backup unavailable"); } }), /backup/);
  assert.deepEqual(auth.events, ["list"]); assert.deepEqual(auth.users, source);
});
test("account changes between global preflight and per-user check stop before mutation", async () => {
  const source = fixture(); const auth = fakeAuth(source); const get = auth.getUser;
  auth.getUser = async (uid) => { const result = await get(uid); result.disabled = true; return result; };
  await assert.rejects(apply(buildPlan(source, exception), auth), /changed before/);
  assert(!auth.events.some((event) => event.startsWith("claims:") || event.startsWith("revoke:")));
});
test("failed revocation journals partial progress without rollback, retry or password/account edits", async () => {
  const source = fixture(); const auth = fakeAuth(source); const journal = [];
  auth.revokeRefreshTokens = async (uid) => { auth.events.push(`revoke:${uid}`); throw new Error("revocation unavailable"); };
  await assert.rejects(apply(buildPlan(source, exception), auth, { record: async (event) => journal.push(event) }), /revocation/);
  assert.equal(auth.users[1].customClaims.authMethod, "google");
  assert.equal(auth.users[0].customClaims.authMethod, undefined);
  assert.deepEqual(journal.map((event) => event.stage), ["claims-write-intent", "claims-set"]);
  assert.equal(auth.events.filter((event) => event.startsWith("claims:")).length, 1);
});
test("replanning after partial mutation still revokes the already marked member", async () => {
  const source = fixture(); source[1].customClaims = { ...source[1].customClaims, authMethod: "google", invitedEmail: exception };
  const auth = fakeAuth(source); await apply(buildPlan(source, exception), auth);
  assert(!auth.events.includes("claims:owner")); assert(auth.events.includes("revoke:owner"));
});
test("post-apply accidental role changes are detected", async () => {
  const source = fixture(); const auth = fakeAuth(source); const setter = auth.setCustomUserClaims;
  auth.setCustomUserClaims = async (uid, claims) => { await setter(uid, { ...claims, role: "teacher_ea" }); };
  await assert.rejects(apply(buildPlan(source, exception), auth), /verification/);
});

test("Windows path casing does not cause an unbounded private-path ancestor walk", () => {
  if (process.platform !== "win32") return;
  const file = path.join(PRIVATE_ROOT.toUpperCase(), "LOCAL", "plan.json");
  assert.equal(privatePath(file), path.resolve(file));
});
test("revocation success with stale timestamp is rejected", async () => {
  const source = fixture(); const auth = fakeAuth(source);
  auth.revokeRefreshTokens = async (uid) => { auth.events.push(`revoke:${uid}`); };
  await assert.rejects(apply(buildPlan(source, exception), auth), /revocation timestamp.*stale/);
});
test("all pages are reviewed and verified without modifying nonmembers", async () => {
  const source = fixture(); const auth = fakeAuth(source);
  auth.listUsers = async (limit, token) => {
    assert.equal(limit, 1000); auth.events.push(`list:${token || "first"}`);
    return token ? { users: structuredClone(auth.users.slice(3)) } : { users: structuredClone(auth.users.slice(0, 3)), pageToken: "next" };
  };
  await apply(buildPlan(source, exception), auth);
  assert.equal(auth.events.filter((event) => event === "list:next").length, 2);
  assert.deepEqual(auth.users[5], source[5]);
});
test("sign-in timestamps may change during review while claims and identity remain fixed", async () => {
  const source = fixture(); const plan = buildPlan(source, exception); const auth = fakeAuth(source);
  auth.users[0].metadata.lastSignInTime = new Date().toISOString();
  assert.equal((await apply(plan, auth)).status, "applied-and-verified");
});
