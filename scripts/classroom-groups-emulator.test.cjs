const assert = require("node:assert/strict");
const { test } = require("node:test");
const { initializeApp, deleteApp } = require("firebase/app");
const {
  getFirestore, connectFirestoreEmulator, collection, doc, setDoc, getDocFromServer, getDocsFromServer, deleteDoc, terminate
} = require("firebase/firestore");

// Run against a fresh local emulator loaded with firestore.rules, never a configured Firebase project.
test("shared classroom groups: CRUD, tenant boundary, claims, revocation and schema", async (t) => {
  const address = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  assert.match(address, /^127\.0\.0\.1:\d+$/);
  const port = Number(address.split(":")[1]);
  const projectId = "demo-classroom-groups";
  const organizationId = "student-assessment";
  function client(uid, role, extra = {}) {
    const app = initializeApp({ projectId }, uid);
    const db = getFirestore(app);
    connectFirestoreEmulator(db, "127.0.0.1", port, { mockUserToken: {
      sub: uid, role, organizationId, authMethod: "google", email: uid + "@example.test", email_verified: true,
      invitedEmail: uid + "@example.test", firebase: { sign_in_provider: "google.com", identities: {} },
      iat: Math.floor(Date.now() / 1000), ...extra
    } });
    t.after(async () => { await terminate(db); await deleteApp(app); });
    return collection(db, "organizations", organizationId, "classroomGroups");
  }
  const denied = (operation) => assert.rejects(operation, { code: "permission-denied" });
  const admin = client("administrator", "admin");
  const teacher = client("teacher", "teacher_ea");
  const group = doc(admin, "custom");
  const value = { name: "Mixed", grades: ["3", "10"] };
  await setDoc(group, value);
  assert.deepEqual((await getDocFromServer(doc(teacher, "custom"))).data(), value);
  assert.ok((await getDocsFromServer(teacher)).docs.some(item => item.id === group.id));
  await setDoc(group, { name: "Renamed", grades: ["5"] });
  assert.equal((await getDocFromServer(doc(teacher, "custom"))).data().name, "Renamed");
  await denied(setDoc(doc(teacher, "custom"), value));
  await denied(deleteDoc(doc(teacher, "custom")));
  for (const data of [
    { ...value, grades: [] }, { ...value, grades: ["3", "3"] }, { ...value, grades: ["13"] },
    { ...value, name: "  " }, { ...value, name: "x".repeat(81) }, { ...value, extra: "field" }, { deleted: true }
  ]) await denied(setDoc(group, data));
  await setDoc(doc(admin, "team-1"), { deleted: true });
  assert.deepEqual((await getDocFromServer(doc(teacher, "team-1"))).data(), { deleted: true });
  await denied(deleteDoc(doc(admin, "team-1")));
  await denied(getDocsFromServer(collection(admin.firestore, "organizations", "other", "classroomGroups")));
  await denied(getDocsFromServer(client("outsider", "admin", { organizationId: "other" })));
  await denied(getDocsFromServer(client("uninvited", "teacher_ea", { invitedEmail: "someone@example.test" })));
  await denied(getDocsFromServer(client("unverified", "admin", { email_verified: false })));
  async function seedMarker(path, fields) {
    const res = await fetch(`http://${address}/v1/projects/${projectId}/databases/(default)/documents/organizations/${organizationId}/${path}`, {
      method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields })
    });
    assert.equal(res.status, 200);
  }
  await seedMarker("revocations/teacher", { uid: { stringValue: "teacher" } });
  await denied(getDocsFromServer(teacher));
  await seedMarker("accessChanges/former-admin", { changedAt: { timestampValue: new Date().toISOString() } });
  const stale = client("former-admin", "admin", { iat: Math.floor(Date.now() / 1000) - 30 });
  await denied(setDoc(doc(stale, "custom"), value));
  await seedMarker("accessChanges/administrator", { changedAt: { timestampValue: new Date(Date.now() - 120_000).toISOString() } });
  assert.ok((await getDocFromServer(group)).exists());
  await deleteDoc(group);
  assert.equal((await getDocFromServer(group)).exists(), false);
});
