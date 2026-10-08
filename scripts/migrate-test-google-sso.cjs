const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");
const { isDeepStrictEqual: equal } = require("node:util");

// Deliberately cannot target production, create accounts, or change roles.
const PROJECT = "student-assessment-test";
const ORGANIZATION = "student-assessment";
const PRIVATE_ROOT = path.resolve(__dirname, "../.tmp/google-sso-migrations");
const PLAN_LIFETIME_MS = 30 * 60 * 1000;
const normalizeEmail = (value) => typeof value === "string" ? value.trim().toLowerCase() : "";
const validEmail = (value) => /^[^\s@*,;]+@[^\s@*,;]+\.[^\s@*,;]+$/.test(value);
const schoolEmail = (value) => /^[^\s@]+@foothillsacademy\.org$/.test(value);
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function parseArguments(argv) {
  const parsed = { mode: "dry-run", project: "", externalEmail: "" };
  const valued = new Map([["--project", "project"], ["--external-email", "externalEmail"],
    ["--account", "account"], ["--plan", "planFile"], ["--confirm-project", "confirmedProject"],
    ["--confirm-plan", "confirmedPlan"]]);
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    assert(!seen.has(flag), "Duplicate argument."); seen.add(flag);
    if (flag === "--apply") { parsed.mode = "apply"; continue; }
    if (flag === "--dry-run") continue;
    assert(valued.has(flag), "Unknown argument.");
    const value = argv[++index];
    assert(value && !value.startsWith("--"), "Missing argument value.");
    parsed[valued.get(flag)] = value;
  }
  assert(!(seen.has("--apply") && seen.has("--dry-run")), "Choose one execution mode.");
  assert.equal(parsed.project, PROJECT, "Only explicit student-assessment-test is allowed.");
  parsed.externalEmail = normalizeEmail(parsed.externalEmail);
  if (seen.has("--external-email")) assert(validEmail(parsed.externalEmail) && !schoolEmail(parsed.externalEmail),
    "The exception must be one exact external email.");
  if (parsed.mode === "apply") {
    assert.equal(parsed.confirmedProject, PROJECT, "Apply requires --confirm-project student-assessment-test.");
    assert(parsed.planFile && /^[a-f0-9]{64}$/.test(parsed.confirmedPlan || ""),
      "Apply requires reviewed --plan and --confirm-plan SHA-256.");
  } else assert(!parsed.planFile && !parsed.confirmedProject && !parsed.confirmedPlan, "Apply-only arguments in dry-run.");
  return parsed;
}

function claimsOf(user) {
  const claims = user.customClaims ?? {};
  assert(claims && typeof claims === "object" && !Array.isArray(claims), "Invalid custom claims.");
  return structuredClone(claims);
}

function accountSnapshot(user) {
  assert(typeof user.uid === "string" && user.uid, "Missing user identity.");
  return { uid: user.uid, email: user.email ?? null, emailVerified: user.emailVerified === true,
    disabled: user.disabled === true, displayName: user.displayName ?? null, tenantId: user.tenantId ?? null,
    customClaims: claimsOf(user),
    providerData: (user.providerData || []).map((provider) => ({ providerId: provider.providerId,
      uid: provider.uid, email: provider.email ?? null })).sort((a, b) => a.providerId.localeCompare(b.providerId)),
    metadata: user.metadata ? { creationTime: user.metadata.creationTime ?? null,
      lastSignInTime: user.metadata.lastSignInTime ?? null, lastRefreshTime: user.metadata.lastRefreshTime ?? null } : null,
    tokensValidAfterTime: user.tokensValidAfterTime ?? null };
}

// Review tolerates sign-in timestamps changing, but never identity or access changes.
function stableSnapshot(user) {
  const snapshot = accountSnapshot(user); delete snapshot.tokensValidAfterTime;
  snapshot.metadata = snapshot.metadata ? { creationTime: snapshot.metadata.creationTime } : null;
  return snapshot;
}

function organizationMembers(users) {
  return users.filter((user) => claimsOf(user).organizationId === ORGANIZATION).sort((a, b) => a.uid.localeCompare(b.uid));
}

function buildPlan(users, externalEmail = "", capturedAt = new Date().toISOString()) {
  externalEmail = normalizeEmail(externalEmail);
  assert(!externalEmail || (validEmail(externalEmail) && !schoolEmail(externalEmail)), "Invalid exact external exception.");
  assert(new Set(users.map((user) => user.uid)).size === users.length, "Duplicate identities.");
  const members = organizationMembers(users); const targets = []; const excluded = [];
  for (const user of members) {
    const before = accountSnapshot(user); const email = normalizeEmail(user.email);
    let reason;
    if (before.tenantId) reason = "tenant-account";
    else if (!["admin", "teacher_ea"].includes(before.customClaims.role)) reason = "invalid-role";
    else if (!schoolEmail(email) && (!externalEmail || email !== externalEmail)) reason = "outside-allowlist";
    if (reason) { excluded.push({ uid: user.uid, reason }); continue; }
    const afterClaims = { ...before.customClaims, authMethod: "google", invitedEmail: email };
    assert(Buffer.byteLength(JSON.stringify(afterClaims), "utf8") <= 1000, "Google claims exceed Firebase size limit.");
    targets.push({ before, afterClaims, claimsChanged: !equal(before.customClaims, afterClaims) });
  }
  return { version: 1, project: PROJECT, organization: ORGANIZATION, externalEmail, capturedAt,
    inventory: members.map(stableSnapshot), targets, excluded };
}

function summarize(plan) {
  return { project: PROJECT, organizationMembers: plan.inventory.length, eligibleMembers: plan.targets.length,
    claimsToUpdate: plan.targets.filter((target) => target.claimsChanged).length, refreshTokensToRevoke: plan.targets.length,
    excludedMembers: plan.excluded.length, excludedByReason: plan.excluded.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1; return counts; }, {}),
    enabledEligibleAdmins: plan.targets.filter(({ before }) => !before.disabled && before.customClaims.role === "admin").length,
    alreadyGoogleLinked: plan.targets.filter(({ before }) => before.providerData.some((p) => p.providerId === "google.com")).length,
    externalExceptionIncluded: plan.targets.some(({ before }) => normalizeEmail(before.email) === plan.externalEmail) };
}

function assertProviderReady(config, google) {
  assert.equal(google.enabled, true, "Test Google provider must be enabled before migration.");
  // An omitted false field has protobuf default false; true permits duplicate email accounts.
  assert(config.signIn && typeof config.signIn === "object" && [undefined, false].includes(config.signIn.allowDuplicateEmails), "Test must link accounts sharing an email.");
  assert(config.blockingFunctions?.triggers?.beforeCreate?.functionUri, "Test beforeCreate invitation block is missing.");
  assert(config.blockingFunctions?.triggers?.beforeSignIn?.functionUri, "Test beforeSignIn access block is missing.");
}

function privatePath(file) {
  const absolute = path.resolve(file); const relative = path.relative(PRIVATE_ROOT, absolute);
  assert(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative),
    "Files must stay inside ignored .tmp/google-sso-migrations.");
  const applicationRoot = path.resolve(__dirname, "..");
  for (let current = absolute; ; current = path.dirname(current)) {
    if (fs.existsSync(current)) assert(!fs.lstatSync(current).isSymbolicLink(), "Migration paths cannot use links.");
    // path.relative handles Windows case differences without an unbounded ancestor walk.
    if (path.relative(applicationRoot, current) === "") break;
    assert(path.dirname(current) !== current, "Invalid private migration ancestry.");
  }
  return absolute;
}

function loadReviewedPlan(args, now = Date.now()) {
  const bytes = fs.readFileSync(privatePath(args.planFile));
  assert.equal(sha256(bytes), args.confirmedPlan, "Reviewed plan changed.");
  const plan = JSON.parse(bytes.toString("utf8"));
  assert.equal(plan.project, PROJECT, "Plan must target student-assessment-test.");
  assert.equal(plan.version, 1, "Unsupported plan version.");
  assert.equal(plan.organization, ORGANIZATION, "Invalid organization.");
  assert.equal(plan.externalEmail, args.externalEmail, "External exception must match reviewed plan.");
  const age = now - Date.parse(plan.capturedAt);
  assert(Number.isFinite(age) && age >= 0 && age <= PLAN_LIFETIME_MS, "Plan expired; repeat dry-run and review.");
  const expected = buildPlan(plan.inventory, plan.externalEmail, plan.capturedAt);
  assert(equal(expected.excluded, plan.excluded), "Plan exclusions are inconsistent.");
  assert.equal(expected.targets.length, plan.targets?.length, "Plan targets are inconsistent.");
  for (const [index, target] of expected.targets.entries()) {
    const supplied = plan.targets[index];
    assert(equal(stableSnapshot(supplied.before), stableSnapshot(target.before)), "Plan account identities are inconsistent.");
    assert(equal(supplied.afterClaims, target.afterClaims) && supplied.claimsChanged === target.claimsChanged,
      "Plan may only add Google method and invited-email binding.");
  }
  return plan;
}

function writePrivateJson(file, data) {
  file = privatePath(file); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600, flush: true });
  assert(fs.statSync(file).size > 0, "Private file write failed."); return file;
}

function writeProtectedBackup(file, data) {
  assert.equal(process.platform, "win32", "Apply requires Windows DPAPI recovery protection.");
  const bytes = Buffer.from(JSON.stringify(data));
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $scope=[Security.Cryptography.DataProtectionScope]::CurrentUser; $protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,$scope); $verified=[Security.Cryptography.ProtectedData]::Unprotect($protected,$null,$scope); if([Convert]::ToBase64String($bytes) -cne [Convert]::ToBase64String($verified)){throw 'Recovery verification failed'}; [Console]::Out.Write([Convert]::ToBase64String($protected))"],
    { input: bytes.toString("base64"), encoding: "utf8", windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
  assert.equal(result.status, 0, "Protected recovery backup failed; no migration attempted.");
  file = privatePath(file); fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const protectedBytes = Buffer.from(result.stdout.trim(), "base64"); assert(protectedBytes.length > 0, "Empty backup.");
  fs.writeFileSync(file, protectedBytes, { flag: "wx", mode: 0o600, flush: true });
  assert(fs.readFileSync(file).equals(protectedBytes), "Protected backup read-back failed."); return file;
}

async function listAllUsers(auth) {
  const users = []; let pageToken;
  do { const page = await auth.listUsers(1000, pageToken); users.push(...page.users); pageToken = page.pageToken; } while (pageToken);
  return users;
}

async function applyReviewedPlan(plan, { auth, providerConfig, backup, record }) {
  assert.equal(plan.project, PROJECT, "Only Test migration is allowed.");
  assertProviderReady(providerConfig.config, providerConfig.google);
  assert(summarize(plan).enabledEligibleAdmins > 0, "An existing enabled eligible Admin is required; role promotion is forbidden.");
  const current = await listAllUsers(auth);
  assert(equal(organizationMembers(current).map(stableSnapshot), plan.inventory),
    "Organization changed since dry-run; repeat review.");
  await backup({ project: PROJECT, capturedAt: new Date().toISOString(), externalEmail: plan.externalEmail,
    members: organizationMembers(current).map(accountSnapshot), plan });
  for (const target of plan.targets) {
    const original = await auth.getUser(target.before.uid);
    assert(equal(stableSnapshot(original), stableSnapshot(target.before)), "Account changed before mutation; stopped without retry.");
    await record({ uid: original.uid, stage: "claims-write-intent", claimsChanged: target.claimsChanged });
    if (target.claimsChanged) await auth.setCustomUserClaims(original.uid, target.afterClaims);
    await record({ uid: original.uid, stage: "claims-set" });
    const revokeNotBefore = Math.floor(Date.now() / 1000) * 1000;
    await auth.revokeRefreshTokens(original.uid);
    await record({ uid: original.uid, stage: "refresh-tokens-revoked" });
    const after = await auth.getUser(original.uid);
    const expected = stableSnapshot(original); expected.customClaims = target.afterClaims;
    assert(equal(stableSnapshot(after), expected), "Post-migration account verification failed; inspect private journal.");
    assert(after.tokensValidAfterTime && Number.isFinite(Date.parse(after.tokensValidAfterTime)) && Date.parse(after.tokensValidAfterTime) >= revokeNotBefore,
      "Refresh-token revocation timestamp is missing or stale.");
    await record({ uid: original.uid, stage: "verified", tokensValidAfterTime: after.tokensValidAfterTime });
  }
  const after = await listAllUsers(auth);
  const expected = plan.inventory.map((snapshot) => {
    const target = plan.targets.find((item) => item.before.uid === snapshot.uid);
    return target ? { ...snapshot, customClaims: target.afterClaims } : snapshot;
  });
  assert(equal(organizationMembers(after).map(stableSnapshot), expected), "Final inventory changed; inspect private journal.");
  return { ...summarize(plan), status: "applied-and-verified" };
}

async function createClients(args) {
  assert(!process.env.FIREBASE_AUTH_EMULATOR_HOST, "Remote Test migration cannot use an Auth emulator.");
  const firebaseRoot = path.join(process.env.APPDATA || "", "npm/node_modules/firebase-tools/lib");
  const cliAuth = require(path.join(firebaseRoot, "auth"));
  const selected = cliAuth.selectAccount(args.account, process.cwd());
  assert(selected?.tokens?.refresh_token, "A logged-in Firebase CLI account is required.");
  cliAuth.setActiveAccount({ project: PROJECT, nonInteractive: true }, selected);
  const requireFunctions = createRequire(path.resolve(__dirname, "../functions/package.json"));
  const { initializeApp, deleteApp } = requireFunctions("firebase-admin/app");
  const { getAuth } = requireFunctions("firebase-admin/auth");
  const app = initializeApp({ projectId: PROJECT, credential: { getAccessToken: () =>
    cliAuth.getAccessToken(selected.tokens.refresh_token, ["https://www.googleapis.com/auth/cloud-platform"]) } }, `test-google-migration-${crypto.randomUUID()}`);
  const { Client } = require(path.join(firebaseRoot, "apiv2"));
  const client = new Client({ urlPrefix: "https://identitytoolkit.googleapis.com" });
  const options = () => ({ retries: 0, timeout: 30000, headers: { "x-goog-user-project": PROJECT },
    skipLog: { body: true, resBody: true } });
  return { auth: getAuth(app), close: () => deleteApp(app), async providerConfig() {
    const config = await client.get(`/admin/v2/projects/${PROJECT}/config`, options());
    const google = await client.get(`/admin/v2/projects/${PROJECT}/defaultSupportedIdpConfigs/google.com`, options());
    return { config: config.body, google: google.body };
  } };
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const plan = args.mode === "apply" ? loadReviewedPlan(args) : null;
  const clients = await createClients(args);
  try {
    if (args.mode === "dry-run") {
      const candidate = buildPlan(await listAllUsers(clients.auth), args.externalEmail);
      const directory = path.join(PRIVATE_ROOT, `${new Date().toISOString().replaceAll(":", "-")}-${crypto.randomUUID()}`);
      const file = writePrivateJson(path.join(directory, "plan.json"), candidate);
      const summary = { ...summarize(candidate), status: "dry-run-no-remote-changes", planFile: file,
        planSha256: sha256(fs.readFileSync(file)), expiresInMinutes: PLAN_LIFETIME_MS / 60000 };
      console.log(JSON.stringify(summary, null, 2)); return summary;
    }
    const directory = path.join(path.dirname(privatePath(args.planFile)), `apply-${crypto.randomUUID()}`);
    const journalFile = privatePath(path.join(directory, "journal.jsonl"));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(journalFile, "", { flag: "wx", mode: 0o600, flush: true });
    const record = (event) => fs.appendFileSync(journalFile, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n", { flush: true });
    record({ stage: "started", project: PROJECT, reviewedPlanSha256: args.confirmedPlan });
    try {
      const summary = await applyReviewedPlan(plan, { auth: clients.auth, providerConfig: await clients.providerConfig(),
        backup: (data) => writeProtectedBackup(path.join(directory, "before-migration.dpapi"), data), record });
      record({ stage: "completed", ...summary }); console.log(JSON.stringify({ ...summary, journalFile }, null, 2)); return summary;
    } catch (error) {
      record({ stage: "stopped", errorType: error.name, errorCode: error.code || null });
      console.error(`Migration stopped. Review the private journal: ${journalFile}`); throw error;
    }
  } finally { await clients.close(); }
}

module.exports = { PROJECT, PRIVATE_ROOT, PLAN_LIFETIME_MS, parseArguments, accountSnapshot, stableSnapshot,
  buildPlan, summarize, assertProviderReady, privatePath, loadReviewedPlan, sha256, applyReviewedPlan, run };
if (require.main === module) run().catch((error) => {
  // Raw assertion output can contain staff records; never dump errors or tokens.
  console.error(`Test Google migration failed (${error.code || error.name || "unknown"}). No automatic retry, rollback, account deletion, or production operation was attempted.`);
  process.exitCode = 1;
});
