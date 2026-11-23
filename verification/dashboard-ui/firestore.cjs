// Only these SDK paths exist in the fixture. No authentication, student data API or network.
const db = Object.freeze({ synthetic: true });
const prefix = "dashboard-acceptance/";
const listeners = new Set();
const metadata = { fromCache: false, hasPendingWrites: false };
function reference(kind, parent, parts) {
  const path = (parent === db ? "" : parent.path + "/") + parts.join("/");
  const local = path.replace(/^organizations\/fixture-org\//, "");
  const valid = local !== path && [
    /^classroomGroups(?:\/[\w-]+)?$/,
    /^userPreferences\/synthetic-(first|second)\/filterFavorites\/(dashboard|student-report)$/,
    /^favoriteShareIndexes\/(dashboard|student-report)\/audiences\/(all|admin)\/entries(?:\/synthetic-(first|second):[\w-]+)?$/,
    /^userPreferences\/synthetic-(first|second)\/sharedFavorites\/(dashboard|student-report)\/items\/[\w-]+$/
  ].some(pattern => pattern.test(local));
  if (!valid || (kind === "doc") !== (path.split("/").length % 2 === 0)) throw Error("Unexpected fixture reference: " + path);
  return { kind, path, id: path.split("/").at(-1) };
}
function snapshot(ref) {
  if (ref.kind === "doc") {
    const data = JSON.parse(localStorage.getItem(prefix + ref.path) || "null") ?? undefined;
    return { id: ref.id, ref, metadata, exists: () => data !== undefined, data: () => data };
  }
  const docs = Object.keys(localStorage).filter(key => key.startsWith(prefix + ref.path + "/"))
    .map(key => snapshot({ kind: "doc", path: key.slice(prefix.length), id: key.split("/").at(-1) }));
  return { docs, metadata };
}
exports.getFirestore = () => db;
exports.collection = (parent, ...parts) => reference("collection", parent, parts);
exports.doc = (parent, ...parts) => reference("doc", parent, parts.length ? parts : [crypto.randomUUID()]);
function assertReadable(ref) {
  if (ref.path.includes("/filterFavorites/") && !ref.path.includes("/userPreferences/" + window.fixtureAccount.uid + "/")) {
    throw Error("Cross-account private source read: " + ref.path);
  }
  if (ref.kind === "collection" && ref.path.includes("/audiences/admin/") && !window.fixtureAccount.isAdmin) {
    throw Error("Staff requested admin index: " + ref.path);
  }
}
exports.onSnapshot = (ref, options, next, failed) => {
  assertReadable(ref);
  if (ref.path.endsWith("/filterFavorites/dashboard") && new URLSearchParams(location.search).has("denyFavorites")) {
    next({ ...snapshot(ref), metadata: { ...metadata, fromCache: true } });
    const deny = () => failed(new Error("Synthetic preference permission denied"));
    window.addEventListener("fixture:deny-favorites", deny, { once: true });
    return () => window.removeEventListener("fixture:deny-favorites", deny);
  }
  let previous;
  const publish = () => {
    if (!listeners.has(publish)) return;
    const result = snapshot(ref);
    const key = JSON.stringify(result.docs ? result.docs.map(d => [d.id, d.data()]) : result.data() ?? null);
    if (key !== previous) { previous = key; next(result); }
  };
  listeners.add(publish);
  queueMicrotask(publish);
  return () => listeners.delete(publish);
};
exports.runTransaction = async (instance, work) => {
  if (instance !== db) throw Error("Unexpected database");
  const writes = [];
  await work({ get: async ref => { assertReadable(ref); return snapshot(ref); },
    set: (ref, value) => writes.push(() => localStorage.setItem(prefix + ref.path, JSON.stringify(value))),
    delete: ref => writes.push(() => localStorage.removeItem(prefix + ref.path)) });
  writes.forEach(write => write());
  [...listeners].forEach(publish => publish());
};
window.addEventListener("storage", event => {
  if (event.key?.startsWith(prefix)) [...listeners].forEach(publish => publish());
});
