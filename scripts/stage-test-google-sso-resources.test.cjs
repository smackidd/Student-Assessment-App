const test = require("node:test");
const assert = require("node:assert/strict");
const { approvedEmail, strengthenConnector, strengthenStorage, strengthenFirestore, stage } = require("./stage-test-google-sso-resources.cjs");
test("rejects production before reading or writing resources", () => {
  assert.throws(() => stage("student-assessment-2d869", "owner@gmail.com"), /only supports/);
});
test("cannot authorize an outside domain or multiple exception addresses", () => {
  for (const email of ["gmail.com", "a@gmail.com,b@gmail.com", "a@gmail.com; b@gmail.com", "staff@foothillsacademy.org"]) assert.throws(() => approvedEmail(email));
});
test("strengthens direct operations and preserves server-only operations", () => {
  const source = 'query A @auth(expr: "auth.token.organizationId == \'student-assessment\' && auth.token.role == \'admin\'") { x }\nquery B @auth(level: NO_ACCESS) { y }';
  const result = strengthenConnector(source, "Owner@gmail.com");
  assert.equal(result.count, 1);
  assert.ok(result.source.includes("sign_in_provider == 'google.com'"));
  assert.ok(result.source.includes("email_verified == true"));
  assert.ok(result.source.includes("auth.token.email == auth.token.invitedEmail"));
  assert.ok(result.source.includes("foothillsacademy[.]org"));
  assert.ok(result.source.includes('owner@gmail.com'));
  assert.ok(result.source.endsWith('query B @auth(level: NO_ACCESS) { y }'));
});
test("refuses an unexpected authorization model", () => {
  assert.throws(() => strengthenConnector('query A @auth(expr: "auth.uid != nil") { x }'), /Unexpected/);
});
test("Storage adds verified Google binding without expanding existing roles", () => {
  const result = strengthenStorage('return request.auth != null;\nfunction isAdmin() { return isSignedIn() && request.auth.token.admin == true; }', "owner@gmail.com");
  assert.ok(result.includes("sign_in_provider == 'google.com'"));
  assert.ok(result.includes("email_verified == true"));
  assert.ok(result.includes("email.lower() == request.auth.token.invitedEmail"));
  assert.ok(result.includes("request.auth.token.admin == true"));
});

test("Firestore binds data access to the same exact exception", () => {
  const source = "&& email() == request.auth.token.invitedEmail;";
  const enabled = strengthenFirestore(source, "owner@gmail.com");
  assert.ok(enabled.includes("foothillsacademy[.]org"));
  assert.ok(enabled.includes('owner@gmail.com'));
  const disabled = strengthenFirestore(source);
  assert.ok(!disabled.includes('owner@gmail.com'));
  assert.ok(!disabled.includes('gmail.com'));
});

test("generated rules preserve regex anchors and do not duplicate source", () => {
  const storage = strengthenStorage("return request.auth != null;\nEND", "owner@gmail.com");
  const firestore = strengthenFirestore("&& email() == request.auth.token.invitedEmail;\nEND", "owner@gmail.com");
  for (const rules of [storage,firestore]) {
    assert.ok(rules.includes("foothillsacademy[.]org$')"));
    assert.equal(rules.split("END").length, 2);
  }
});
