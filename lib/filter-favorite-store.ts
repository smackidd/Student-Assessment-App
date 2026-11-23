import { collection, doc, onSnapshot, runTransaction, type Firestore } from "firebase/firestore";
import {
  changeFavorites, favoriteDocument, readFavorites, shareableFilters, sharedAudience, validFavoriteId, validFavoriteItem,
  type FavoriteScope, type FavoriteStore, type FilterFavorite, type ListedFavorite, type ShareAudience
} from "./filter-favorites";

type WatchedShare = { ready: boolean; item?: ListedFavorite; stop: () => void; retry?: () => void };
const snapshotOptions = { includeMetadataChanges: true } as const;

export function createFavoriteStore(db: Firestore, orgId: string): FavoriteStore {
  const org = ["organizations", orgId] as const;
  const sourceRef = (uid: string, scope: FavoriteScope) => doc(db, ...org, "userPreferences", uid, "filterFavorites", scope);
  const detailRef = (uid: string, scope: FavoriteScope, id: string) =>
    doc(db, ...org, "userPreferences", uid, "sharedFavorites", scope, "items", id);
  const index = (scope: FavoriteScope, audience: ShareAudience) =>
    collection(db, ...org, "favoriteShareIndexes", scope, "audiences", audience, "entries");
  const handleRef = (uid: string, scope: FavoriteScope, id: string, audience: ShareAudience) =>
    doc(db, ...org, "favoriteShareIndexes", scope, "audiences", audience, "entries", `${uid}:${id}`);

  return {
    subscribe(uid, scope, next, failed, isAdmin) {
      const audiences: ShareAudience[] = isAdmin ? ["all", "admin"] : ["all"];
      const directories = new Map<ShareAudience, Map<string, WatchedShare>>();
      const stops: (() => void)[] = [];
      let own: FilterFavorite[] | undefined;
      let active = true, initialized = false, reconciling = false;
      function stop() {
        active = false;
        stops.splice(0).forEach((unsub) => unsub());
        for (const shares of directories.values()) for (const share of shares.values()) share.stop();
        directories.clear();
      }
      function track(unsub: () => void) { if (active) stops.push(unsub); else unsub(); }
      function fail() { if (active) { stop(); failed(); } }
      function emit() {
        if (!active || !own || reconciling || directories.size !== audiences.length) return;
        const received = new Map<string, ListedFavorite>();
        for (const shares of directories.values()) for (const share of shares.values()) {
          // Restore saved report references only once the entire initial authorized listing has settled.
          if (!initialized && !share.ready) return;
          if (share.item) received.set(share.item.id, share.item);
        }
        initialized = true;
        next([...own, ...received.values()]);
      }

      function watchDetail(shares: Map<string, WatchedShare>, audience: ShareAudience, key: string, ownerUid: string, favoriteId: string) {
        shares.get(key)?.stop();
        const share: WatchedShare = { ready: false, stop: () => {} };
        shares.set(key, share);
        const current = () => active && shares.get(key) === share && !share.retry;
        share.stop = onSnapshot(detailRef(ownerUid, scope, favoriteId), snapshotOptions, (detail) => {
          if (!current() || detail.metadata.hasPendingWrites) return;
          if (detail.metadata.fromCache) {
            if (share.item) { delete share.item; emit(); }
            return;
          }
          const data = detail.data();
          share.item = validFavoriteItem(favoriteId, data) && data.audience === audience && shareableFilters(scope, data.value)
            ? { ...data, id: `shared:${key}`, sharedOwner: ownerUid } : undefined;
          share.ready = true;
          emit();
        }, (error) => {
          if (!current()) return;
          if (error.code !== "permission-denied" && error.code !== "not-found") { fail(); return; }
          // A legacy unpublish may leave a handle. A denied listener is terminal; retry on new evidence, not a polling loop.
          delete share.item;
          share.ready = true;
          share.retry = () => watchDetail(shares, audience, key, ownerUid, favoriteId);
          emit();
        });
        if (!active) share.stop();
      }
      if (typeof window !== "undefined") {
        const retryDenied = () => {
          for (const shares of directories.values()) for (const share of shares.values()) if (active) share.retry?.();
        };
        window.addEventListener("focus", retryDenied);
        window.addEventListener("online", retryDenied);
        track(() => { window.removeEventListener("focus", retryDenied); window.removeEventListener("online", retryDenied); });
      }
      track(onSnapshot(sourceRef(uid, scope), snapshotOptions, (snap) => {
        if (!active || snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
        try { own = readFavorites(snap.data()); } catch { fail(); return; }
        emit();
      }, fail));

      for (const audience of audiences) {
        if (!active) break;
        track(onSnapshot(index(scope, audience), snapshotOptions, (snapshot) => {
          if (!active || snapshot.metadata.hasPendingWrites) return;
          const shares = directories.get(audience) ?? new Map<string, WatchedShare>();
          if (snapshot.metadata.fromCache && !directories.has(audience)) return;
          directories.set(audience, shares);
          const handles = new Map<string, { ownerUid: string; favoriteId: string }>();
          if (!snapshot.metadata.fromCache) for (const entry of snapshot.docs) {
            const { ownerUid, favoriteId } = entry.data();
            if (typeof ownerUid !== "string" || !ownerUid || ownerUid.includes("/") || ownerUid === uid
              || !validFavoriteId(favoriteId) || entry.id !== `${ownerUid}:${favoriteId}`) continue;
            handles.set(entry.id, { ownerUid, favoriteId });
          }
          reconciling = true;
          for (const [key, share] of shares) if (!handles.has(key)) { shares.delete(key); share.stop(); }
          for (const [key, { ownerUid, favoriteId }] of handles) {
            if (!active) break;
            const prior = shares.get(key);
            if (prior) prior.retry?.();
            else watchDetail(shares, audience, key, ownerUid, favoriteId);
          }
          reconciling = false;
          emit();
        }, fail));
      }
      return stop;
    },
    async write(uid, scope, action) {
      const ref = sourceRef(uid, scope);
      await runTransaction(db, async (tx) => {
        const current = readFavorites((await tx.get(ref)).data());
        const items = changeFavorites(current, action);
        const oldAudience = sharedAudience(current.find((item) => item.id === action.id)?.audience);
        const item = items.find((entry) => entry.id === action.id);
        const audience = sharedAudience(item?.audience);
        if (audience && item && !shareableFilters(scope, item.value)) throw new Error("Only chart filters can be shared.");

        if (items.length) tx.set(ref, favoriteDocument(items, action.id));
        else tx.delete(ref);
        if (oldAudience && oldAudience !== audience) tx.delete(handleRef(uid, scope, action.id, oldAudience));
        if (audience && item) {
          tx.set(handleRef(uid, scope, action.id, audience), { ownerUid: uid, favoriteId: item.id });
          tx.set(detailRef(uid, scope, item.id), item);
        } else if (oldAudience) tx.delete(detailRef(uid, scope, action.id));
      });
    }
  };
}
