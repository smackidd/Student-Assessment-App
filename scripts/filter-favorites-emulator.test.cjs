const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const { test } = require("node:test");
const { initializeApp, deleteApp } = require("firebase/app");
const {
  getFirestore, connectFirestoreEmulator, doc, collection, runTransaction, setDoc, getDocFromServer,
  getDocsFromServer, deleteDoc, terminate, setLogLevel, writeBatch, onSnapshot
} = require("firebase/firestore");

function fixture(t) {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  assert.match(host, /^127\.0\.0\.1:\d+$/);
  const org = "student-assessment", projectId = "demo-classroom-groups";
  const denied = (promise) => assert.rejects(promise, { code: "permission-denied" });
  setLogLevel("silent");
  function client(label, uid, extra = {}) {
    const app = initializeApp({ projectId }, label), db = getFirestore(app);
    connectFirestoreEmulator(db, "127.0.0.1", Number(host.split(":")[1]), uid == null ? {} : { mockUserToken: {
      sub: uid, role: "teacher_ea", organizationId: org, authMethod: "google", email: uid + "@example.test",
      invitedEmail: uid + "@example.test", email_verified: true, firebase: { sign_in_provider: "google.com", identities: {} },
      iat: Math.floor(Date.now() / 1000), ...extra
    } });
    t.after(async () => { await terminate(db); await deleteApp(app); });
    return db;
  }
  const ref = (db, uid, scope = "student-report", tenant = org) =>
    doc(db, "organizations", tenant, "userPreferences", uid, "filterFavorites", scope);
  const detail = (db, uid, id, scope = "dashboard", tenant = org) =>
    doc(db, "organizations", tenant, "userPreferences", uid, "sharedFavorites", scope, "items", id);
  const entries = (db, audience, scope = "dashboard", tenant = org) =>
    collection(db, "organizations", tenant, "favoriteShareIndexes", scope, "audiences", audience, "entries");
  async function marker(path, fields) {
    const res = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/organizations/${org}/${path}`, {
      method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
    assert.equal(res.status, 200);
  }
  return { client, ref, detail, entries, marker, denied, org };
}

const envelope = (v) => ({ version: 1, changedId: v.id, items: { [v.id]: v } });
const chart = { chartType: "progression", assessmentId: "orf", roundId: "all", teamId: "all",
  homerooms: [], fieldKeys: [], sectionIds: [], years: null };

function watchDetail(ref) {
  const events = new EventEmitter();
  const stop = onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    if (!snap.metadata.fromCache) events.emit("server", { data: snap.data() });
  }, error => events.emit("server", { code: error.code }));
  return { stop, next: async () => (await once(events, "server", { signal: AbortSignal.timeout(15000) }))[0] };
}

test("favorites: cross-browser owner CRUD, isolation, schema and current membership", async (t) => {
  const { client, ref: ownerRef, denied, marker, org } = fixture(t);
  const owner = "fav-teacher", a = client("browser-1", owner), b = client("browser-2", owner);
  const other = client("other-account", "fav-admin", { role: "admin" });
  const ref = (db, uid = owner, scope, tenant) => ownerRef(db, uid, scope, tenant);
  const value = { studentIds: ["synthetic-1"], years: ["2025"], assessmentIds: ["orf"] };
  const item = { id: "a", revision: 1, name: "Review", value };
  const saved = envelope(item);
  await runTransaction(a, async (tx) => { assert.equal((await tx.get(ref(a))).exists(), false); tx.set(ref(a), saved); });
  assert.deepEqual((await getDocFromServer(ref(b))).data(), saved);
  await runTransaction(b, async (tx) => {
    const prior = (await tx.get(ref(b))).data().items.a;
    tx.set(ref(b), envelope({ ...prior, revision: 2, name: "Renamed" }));
  });
  assert.equal((await getDocFromServer(ref(a))).data().items.a.name, "Renamed");
  const chartValue = { ...chart, studentKey: "all" };
  await setDoc(ref(a, owner, "dashboard"), envelope({ ...item, value: chartValue }));
  await denied(getDocsFromServer(collection(a, "organizations", org, "userPreferences", owner, "filterFavorites")));
  for (const forbidden of [ref(other), ref(a, owner, "student-report", "other"), ref(a, owner, "arbitrary"),
    ref(client("wrong-org", owner, { organizationId: "other" })), ref(client("not-invited", owner, { invitedEmail: "other@example.test" }))]) {
    await denied(getDocFromServer(forbidden));
    await denied(setDoc(forbidden, saved));
    await denied(deleteDoc(forbidden));
  }
  for (const malformed of [
    { ...saved, version: 2 }, { ...saved, other: true }, { ...saved, items: [] }, { ...saved, items: {} },
    envelope({ ...item, name: "  " }), envelope({ ...item, name: "a".repeat(81) }), envelope({ ...item, revision: "2" }),
    envelope({ ...item, value: { ...value, studentNames: ["not a filter"] } }),
    envelope({ ...item, value: { ...value, studentIds: 2 } }),
    { ...saved, items: { a: item, b: { ...item, id: "b" } } }
  ]) await denied(setDoc(ref(b), malformed));
  await runTransaction(b, async (tx) => { await tx.get(ref(b)); tx.delete(ref(b)); });
  assert.equal((await getDocFromServer(ref(a))).exists(), false);
  assert.equal((await getDocFromServer(ref(a, owner, "dashboard"))).exists(), true);
  await marker("revocations/" + owner, { uid: { stringValue: owner } });
  await denied(getDocFromServer(ref(b, owner, "dashboard")));
  await denied(setDoc(ref(a), saved));
});

test("dashboard: mixed-client writes preserve siblings and validate the whole student selection", async (t) => {
  const { client, ref, denied } = fixture(t);
  const uid = "mixed-owner", db = client(uid, uid), source = ref(db, uid, "dashboard");
  const legacy = { id: "old", name: "Old", revision: 1, value: { ...chart, studentKey: "all" } };
  const modern = { id: "new", name: "New", revision: 1, value: { ...chart, studentIds: [] } };
  const roster = Array.from({ length: 2000 }, (_, i) => `student-${i}`);
  await setDoc(source, envelope(legacy));
  const mixed = (old, next, changedId) => ({ version: 1, changedId, items: { old, new: next } });
  await setDoc(source, mixed(legacy, modern, "new"));
  const single = { ...legacy, value: { ...chart, studentKey: "student-7" } };
  await setDoc(source, mixed(single, modern, "old"));
  const large = { ...modern, value: { ...chart, studentIds: roster } };
  await setDoc(source, mixed(single, large, "new"));
  assert.deepEqual((await getDocFromServer(source)).data().items, { old: single, new: large });
  const bad = [
    {}, { studentKey: null }, { studentKey: 7 }, { studentKey: [] }, { studentKey: "all", studentIds: [] },
    { studentIds: null }, { studentIds: "all" }, { studentIds: {} }, { studentIds: [...roster, "one-too-many"] },
    ...[41, false, null, { score: 12 }, "", "all", "student-0", "one\ntwo", "x".repeat(257)]
      .map(last => ({ studentIds: [...roster.slice(0, -1), last] }))
  ];
  for (const selectors of bad) await denied(setDoc(source, mixed(single,
    { ...modern, value: { ...chart, ...selectors } }, "new")));
  await denied(setDoc(source, mixed(legacy, modern, "new")));
  const converted = { ...single, value: { ...chart, studentIds: ["student-7"] } };
  await setDoc(source, mixed(converted, large, "old"));
  await setDoc(source, mixed(single, large, "old"));
  await setDoc(source, { version: 1, changedId: "old", items: { new: large } });
  assert.deepEqual((await getDocFromServer(source)).data().items, { new: large });
});

for (const scope of ["dashboard", "student-report"]) {
  test(scope + ": source-bound audience discovery, atomic publication and legacy invalidation", async (t) => {
    const { client, ref, detail, entries, denied, marker } = fixture(t);
    const uid = "publisher:" + scope, readerUid = "staff-" + scope, adminUid = "admin-" + scope;
    const now = Math.floor(Date.now() / 1000);
    const author = client(uid, uid), staff = client(readerUid, readerUid);
    const admin = client(adminUid, adminUid, { role: "admin", iat: now - 120 });
    const signedOut = client("signed-out-" + scope, null);
    const source = ref(author, uid, scope);
    const details = (db, tenant) => detail(db, uid, "a", scope, tenant);
    const dir = (db, audience, tenant) => entries(db, audience, scope, tenant);
    const key = uid + ":a", handle = { ownerUid: uid, favoriteId: "a" };
    const entry = (db, audience) => doc(dir(db, audience), key);
    const get = async r => (await getDocFromServer(r)).data();
    const list = async (db, aud) => (await getDocsFromServer(dir(db, aud))).docs.map(d => [d.id, d.data()]);
    const value = scope === "dashboard" ? { ...chart, studentIds: ["first", "second"] }
      : { assessmentIds: ["orf"], studentIds: ["first"], years: ["2026"] };
    const priv = { id: "a", revision: 1, name: "Selection", value };
    const all = { ...priv, audience: "all" };
    const restricted = { ...all, revision: 2, audience: "admin" };
    function publish(item, oldAudience) {
      const batch = writeBatch(author);
      batch.set(source, envelope(item));
      if (oldAudience && oldAudience !== item.audience) batch.delete(entry(author, oldAudience));
      batch.set(entry(author, item.audience), handle);
      batch.set(details(author), item);
      return batch.commit();
    }
    await setDoc(source, envelope(priv));
    await denied(setDoc(details(author), all));
    await denied(setDoc(entry(author, "all"), handle));
    await denied(setDoc(source, envelope(all)));
    await denied(setDoc(source, envelope({ ...priv, audience: null })));
    await denied(setDoc(source, envelope({ ...priv, audience: "public" })));
    await denied(publish({ ...all, value: { ...value, [scope === "dashboard" ? "fieldKeys" : "years"]: [{ score: 96 }] } }));
    assert.deepEqual((await get(source)).items.a, priv);
    assert.deepEqual(await list(staff, "all"), []);
    await publish(all);
    assert.deepEqual(await list(staff, "all"), [[key, handle]]);
    assert.deepEqual(await get(details(staff)), all);
    assert.deepEqual(await get(details(admin)), all);
    await denied(getDocsFromServer(details(admin).parent));
    for (const reader of [staff, admin]) {
      await denied(get(ref(reader, uid, scope)));
      await denied(setDoc(ref(reader, uid, scope), envelope(all)));
      await denied(setDoc(details(reader), all));
      await denied(deleteDoc(details(reader)));
      await denied(setDoc(entry(reader, "all"), handle));
      await denied(deleteDoc(entry(reader, "all")));
    }
    await denied(setDoc(details(author), { ...all, revision: 5 }));
    await denied(setDoc(details(author), { ...all, ownerUid: "another" }));
    await denied(setDoc(details(author), { ...all, name: "Different" }));
    await denied(setDoc(details(author), { ...all, value: {} }));
    await denied(setDoc(entry(author, "all"), { ...handle, name: all.name }));
    await denied(setDoc(doc(dir(author, "all"), "someone-else:a"), handle));
    await denied(setDoc(doc(dir(author, "all"), key), { ...handle, favoriteId: "b" }));
    await denied(setDoc(entry(author, "admin"), handle));
    await denied(deleteDoc(entry(author, "all")));
    await denied(deleteDoc(details(author)));
    await denied(publish(restricted)); // Cannot narrow without retiring the old "all" directory entry.
    await denied(getDocsFromServer(dir(staff, "admin")));
    await denied(getDocsFromServer(dir(admin, "other")));
    await denied(getDocsFromServer(dir(admin, "all", "other-tenant")));
    await denied(get(details(admin, "other-tenant")));
    await denied(getDocsFromServer(dir(signedOut, "all")));
    await denied(get(details(signedOut)));
    await denied(get(ref(signedOut, uid, scope)));
    for (const claims of [{ organizationId: "other" }, { email_verified: false }, { invitedEmail: "wrong@example.test" },
      { role: "unknown" }, { authMethod: "password" }, { firebase: { sign_in_provider: "password", identities: {} } }]) {
      const invalid = client(scope + "-" + Object.keys(claims)[0], uid, claims);
      await denied(getDocsFromServer(dir(invalid, "all")));
      await denied(get(details(invalid)));
      await denied(setDoc(details(invalid), all));
      await denied(deleteDoc(entry(invalid, "all")));
    }
    await publish(restricted, "all");
    assert.deepEqual(await list(admin, "admin"), [[key, handle]]);
    assert.deepEqual(await list(staff, "all"), []);
    await denied(get(details(staff)));
    assert.deepEqual(await get(details(admin)), restricted);
    await denied(setDoc(entry(author, "all"), handle));
    await denied(setDoc(details(author), { ...restricted, audience: "all" }));
    const forged = writeBatch(author);
    forged.set(source, envelope({ ...restricted, name: "Partial update" }));
    forged.set(details(author), { ...restricted, audience: "all" });
    await denied(forged.commit());
    assert.deepEqual(await get(details(admin)), restricted);

    await marker("accessChanges/" + adminUid, { changedAt: { timestampValue: new Date((now - 60) * 1000).toISOString() } });
    await denied(get(details(admin)));
    await denied(list(admin, "admin"));
    const demoted = client("downgraded-" + scope, adminUid);
    await denied(get(details(demoted)));
    await denied(list(demoted, "admin"));
    await publish(all, "admin");
    assert.deepEqual(await get(details(demoted)), all);
    assert.deepEqual(await list(demoted, "all"), [[key, handle]]);

    // Legacy clients can edit private siblings, but cannot orphan a published
    // copy even by deleting its entire private document.
    await denied(setDoc(source, envelope(priv)));
    await denied(deleteDoc(source));
    for (const cleanup of [details(author), entry(author, "all")]) {
      const partial = writeBatch(author);
      partial.set(source, envelope(priv));
      partial.delete(cleanup);
      await denied(partial.commit());
    }
    assert.deepEqual((await get(source)).items.a, all);
    assert.deepEqual(await get(details(staff)), all);
    const sibling = { ...priv, id: "b", name: "Other" };
    await setDoc(source, { version: 1, changedId: "b", items: { a: all, b: sibling } });
    await denied(deleteDoc(source));
    await denied(setDoc(source, { version: 1, changedId: "a", items: { b: sibling } }));
    await setDoc(source, { version: 1, changedId: "b", items: { a: all } });
    await denied(deleteDoc(source)); // changedId is "b", but the last item is "a".

    // New clients clean up discovery + detail in the same transaction as the source.
    for (const deleting of [false, true]) {
      await publish(all);
      const batch = writeBatch(author);
      if (deleting) batch.delete(source); else batch.set(source, envelope(priv));
      batch.delete(entry(author, "all"));
      batch.delete(details(author));
      const live = watchDetail(details(staff));
      try {
        assert.deepEqual(await live.next(), { data: all });
        const changed = live.next();
        await batch.commit();
        const event = await changed;
        assert.ok(event.code === "permission-denied" || ("data" in event && event.data === undefined));
      } finally { live.stop(); }
      assert.deepEqual(await list(staff, "all"), []);
      await denied(get(details(staff)));
    }
    await publish(all);
    await marker("revocations/" + readerUid, { uid: { stringValue: readerUid } });
    await denied(list(staff, "all"));
    await denied(get(details(staff)));
    await marker("revocations/" + uid, { uid: { stringValue: uid } });
    await denied(get(source));
    await denied(publish(restricted, "all"));
    await denied(deleteDoc(details(author)));
    await denied(deleteDoc(entry(author, "all")));
  });
}
