import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase/firestore";
import { createFavoriteStore } from "./filter-favorite-store";
import { readFavorites } from "./filter-favorites";

const sdk = vi.hoisted(() => ({ doc: vi.fn(), collection: vi.fn(), onSnapshot: vi.fn(), runTransaction: vi.fn() }));
vi.mock("firebase/firestore", () => sdk);
const db = {} as Firestore;
const store = createFavoriteStore(db, "example-org");

beforeEach(() => {
  vi.resetAllMocks();
  sdk.doc.mockImplementation((_db: Firestore, ...segments: string[]) => segments.join("/"));
  sdk.collection.mockImplementation((_db: Firestore, ...segments: string[]) => segments.join("/"));
});

const org = "organizations/example-org";
const source = (uid: string) => `${org}/userPreferences/${uid}/filterFavorites/student-report`;
const detail = (uid: string) => `${org}/userPreferences/${uid}/sharedFavorites/student-report/items/a`;
const index = (audience: "all" | "admin") => `${org}/favoriteShareIndexes/student-report/audiences/${audience}/entries`;
const value = { studentIds: ["id1"], assessmentIds: ["test"], years: ["2026"] };
const snapshot = (data: unknown, fromCache = false, hasPendingWrites = false) => ({
  data: () => data, metadata: { fromCache, hasPendingWrites }
});
const listing = (...owners: string[]) => ({ ...snapshot(undefined), docs: owners.map((ownerUid) => ({
  id: ownerUid + ":a", data: () => ({ ownerUid, favoriteId: "a" })
})) });

function subscribe(isAdmin: boolean) {
  const next = vi.fn(), failed = vi.fn();
  sdk.onSnapshot.mockImplementation(() => vi.fn());
  const stop = store.subscribe("me", "student-report", next, failed, isAdmin);
  function listener(path: string) {
    const n = sdk.onSnapshot.mock.calls.findLastIndex((args) => args[0] === path);
    if (n === -1) throw new Error("Unexpected missing listener: " + path);
    const [, options, publish, fail] = sdk.onSnapshot.mock.calls[n];
    expect(options).toEqual({ includeMetadataChanges: true });
    return { publish, fail, stop: sdk.onSnapshot.mock.results[n].value };
  }
  return { next, failed, listener, stop };
}

describe("account-backed favorite store", () => {
  it("runs each mutation on the latest owner/scope document and never replaces unrelated favorites", async () => {
    const data = new Map<string, unknown>();
    const tx = {
      get: async (path: string) => ({ data: () => data.get(path) }),
      set: (path: string, value: unknown) => data.set(path, value),
      delete: (path: string) => data.delete(path)
    };
    sdk.runTransaction.mockImplementation((_db, change) => change(tx));
    const initial = { type: "save" as const, id: "a", name: "Winter", value: { years: null } };
    await store.write("one", "dashboard", initial);
    await store.write("one", "student-report", initial);
    await store.write("two", "dashboard", initial);
    await store.write("one", "dashboard", { ...initial, id: "b", name: "Fall" });
    await store.write("one", "dashboard", { ...initial, type: "update", revision: 1, name: "Spring" });
    await expect(store.write("one", "dashboard", { type: "delete", id: "a", revision: 1 })).rejects.toThrow(/changed/);
    await store.write("one", "dashboard", { type: "delete", id: "a", revision: 2 });
    expect(readFavorites(data.get("organizations/example-org/userPreferences/one/filterFavorites/dashboard")).map((r) => r.name)).toEqual(["Fall"]);
    await store.write("one", "dashboard", { type: "delete", id: "b", revision: 1 });
    expect([...data.keys()].sort()).toEqual([
      "organizations/example-org/userPreferences/one/filterFavorites/student-report",
      "organizations/example-org/userPreferences/two/filterFavorites/dashboard"
    ]);
    expect(sdk.runTransaction).toHaveBeenCalledTimes(8);
  });

  it("atomically replaces and removes the projection with the source, reading only the owner's source", async () => {
    let data = new Map<string, unknown>();
    const gets = vi.fn();
    sdk.runTransaction.mockImplementation(async (_db, change) => {
      const pending = new Map(data);
      await change({
        get: (path: string) => { gets(path); return snapshot(data.get(path)); },
        set: (path: string, v: unknown) => pending.set(path, v),
        delete: (path: string) => pending.delete(path)
      });
      data = pending;
    });
    const base = { id: "a", name: "Ready", value };
    const save = (action: Parameters<typeof store.write>[2]) => store.write("me", "student-report", action);
    const assertState = (revision: number, audience?: "all" | "admin") => {
      const item = readFavorites(data.get(source("me")))[0];
      expect(item.revision).toBe(revision);
      expect(item.audience).toBe(audience);
      expect(data.get(detail("me"))).toEqual(audience ? item : undefined);
      for (const a of ["all", "admin"] as const) expect(data.get(index(a) + "/me:a"))
        .toEqual(a === audience ? { ownerUid: "me", favoriteId: "a" } : undefined);
    };
    await save({ ...base, type: "save" });
    assertState(1);
    await save({ id: "a", type: "share", revision: 1, audience: "admin" });
    assertState(2, "admin");
    await save({ id: "a", type: "share", revision: 2, audience: "all" });
    assertState(3, "all");
    const changedValue = { ...value, studentIds: ["id2"] };
    await save({ ...base, type: "update", revision: 3, value: changedValue, name: "Latest" });
    assertState(4, "all");
    expect(data.get(detail("me"))).toMatchObject({ value: changedValue });
    await expect(save({ ...base, type: "update", revision: 3 })).rejects.toThrow(/changed/);
    await expect(save({ ...base, type: "update", revision: 4, value: { ...value, scores: [49] } })).rejects.toThrow(/Only chart filters/);
    assertState(4, "all");
    await save({ id: "a", type: "share", revision: 4 });
    assertState(5);
    expect(readFavorites(data.get(source("me")))[0]).toMatchObject({ name: "Latest", value: changedValue });
    await save({ id: "a", type: "share", revision: 5, audience: "all" });
    expect(data.get(detail("me"))).toMatchObject({ name: "Latest", value: changedValue });
    await save({ type: "delete", id: "a", revision: 6 });
    expect(data.size).toBe(0);
    expect(gets.mock.calls.every(([path]) => path === source("me"))).toBe(true);
  });

  it("lists only eligible directories, namespaces same IDs, skips own handles, and withdraws removed shares", () => {
    const { next, failed, listener, stop } = subscribe(true);
    const item = { id: "a", name: "January", value, revision: 1 };
    listener(source("me")).publish(snapshot({ version: 1, items: { a: item } }));
    listener(index("all")).publish(listing("me", "other"));
    listener(index("admin")).publish(listing("admin:two"));
    const all = listener(detail("other")), admin = listener(detail("admin:two"));
    all.publish(snapshot({ ...item, audience: "all" }));
    expect(next).not.toHaveBeenCalled();
    admin.publish(snapshot({ ...item, audience: "admin" }));
    expect(next.mock.lastCall?.[0].map((f: { id: string }) => f.id)).toEqual(["a", "shared:other:a", "shared:admin:two:a"]);
    expect(sdk.doc.mock.calls.some(([, ...path]) => path.join("/") === source("other"))).toBe(false);
    expect(sdk.doc.mock.calls.some(([, ...path]) => path.join("/") === detail("me"))).toBe(false);
    listener(index("all")).publish(listing("me"));
    expect(all.stop).toHaveBeenCalledOnce();
    all.publish(snapshot({ ...item, audience: "all" }));
    expect(next.mock.lastCall?.[0]).toHaveLength(2);
    admin.fail({ code: "permission-denied" });
    expect(next.mock.lastCall?.[0]).toEqual([item]);
    expect(failed).not.toHaveBeenCalled();
    listener(index("admin")).publish(listing("admin:two"));
    expect(admin.stop).toHaveBeenCalledOnce();
    admin.publish(snapshot({ ...item, name: "Stale", audience: "admin" }));
    expect(next.mock.lastCall?.[0]).toEqual([item]);
    const republished = listener(detail("admin:two"));
    republished.publish(snapshot({ ...item, name: "Republished", audience: "admin" }));
    expect(next.mock.lastCall?.[0][1].name).toBe("Republished");
    stop();
    expect(republished.stop).toHaveBeenCalledOnce();
    const count = next.mock.calls.length;
    listener(index("all")).publish(listing("other"));
    expect(next).toHaveBeenCalledTimes(count);
  });

  it("never reads the admin directory as staff or emits cached, pending or stale details", () => {
    const { next, failed, listener } = subscribe(false);
    expect(sdk.collection.mock.calls.map(([, ...p]) => p.join("/"))).toEqual([index("all")]);
    const own = listener(source("me")), handles = listener(index("all"));
    own.publish(snapshot(undefined, true));
    own.publish(snapshot(undefined, false, true));
    handles.publish({ ...listing("untrusted"), metadata: { fromCache: true, hasPendingWrites: false } });
    expect(sdk.doc).toHaveBeenCalledTimes(1);
    handles.publish(listing("other"));
    own.publish(snapshot(undefined));
    const chart = listener(detail("other")), item = { id: "a", name: "X", revision: 1, value, audience: "all" };
    chart.publish(snapshot(item, true));
    chart.publish(snapshot(item, false, true));
    expect(next).not.toHaveBeenCalled();
    for (const invalid of [undefined, { ...item, audience: "admin" }, { ...item, id: "bad" }, { ...item, value: { scores: [50] } }]) {
      chart.publish(snapshot(invalid));
      expect(next.mock.lastCall?.[0]).toEqual([]);
    }
    own.publish(snapshot({ version: 8 }));
    expect(failed).toHaveBeenCalledOnce();
    expect(chart.stop).toHaveBeenCalledOnce();
    const count = next.mock.calls.length;
    chart.publish(snapshot(item));
    expect(next).toHaveBeenCalledTimes(count);
  });
});
