"use client";

import { useEffect, useId, useRef, useState } from "react";
import { getFirestore } from "firebase/firestore";
import { firebaseApp } from "@/lib/firebase";
import { organizationId } from "@/lib/organization-auth";
import { createFavoriteStore } from "@/lib/filter-favorite-store";
import {
  favoriteLabels, maxFavoriteNameLength, sharedAudience,
  type ListedFavorite, type FilterFavoritesProps, type ShareAudience
} from "@/lib/filter-favorites";
import styles from "./filter-favorites.module.css";

const remoteStore = () => createFavoriteStore(getFirestore(firebaseApp), organizationId);

export function FilterFavorites<T>(props: FilterFavoritesProps<T>) {
  if (!props.uid) return null;
  return <FavoriteControls key={JSON.stringify([props.uid, props.scope, props.isAdmin])} {...props} />;
}

function FavoriteControls<T>({ uid, scope, isAdmin, value, decode, onApply, store }: FilterFavoritesProps<T>) {
  const [items, setItems] = useState<ListedFavorite[]>([]);
  const [selection, setSelection] = useState("");
  const [name, setName] = useState("");
  const [audience, setAudience] = useState<ShareAudience | undefined>();
  const [notice, setNotice] = useState("");
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const details = useRef<HTMLDetailsElement>(null);
  const sharingHint = useId();
  const selected = items.find((item) => item.id === selection);
  const lastRenderedSelection = useRef("");
  const labels = favoriteLabels(items);
  const editable = !selection || (!!selected && !selected.sharedOwner);
  const sharingChanged = !!selected && !selected.sharedOwner && audience !== sharedAudience(selected.audience);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    const unsubscribe = (store ?? remoteStore()).subscribe(uid, scope, (saved) => {
      if (active) { setItems(saved); setStatus("ready"); }
    }, () => {
      if (active) { setItems([]); setName(""); setSelection(""); setAudience(undefined); setNotice(""); setStatus("failed"); }
    }, isAdmin);
    return () => { active = false; unsubscribe(); };
  }, [uid, scope, store, attempt, isAdmin]);

  // Deleting a selected favorite elsewhere must never leave a new draft opted in.
  useEffect(() => {
    if (selected) { lastRenderedSelection.current = selected.id; return; }
    if (selection && selection === lastRenderedSelection.current && !busy && status === "ready") {
      setSelection(""); setName(""); setAudience(undefined); setConfirmDelete(false); setRevision(0); setNotice("");
    }
    if (!selection) lastRenderedSelection.current = "";
  }, [selection, selected, busy, status]);

  function select(id: string) {
    const item = items.find((entry) => entry.id === id);
    setSelection(id);
    setName(item?.name ?? "");
    setRevision(item?.revision ?? 0);
    setAudience(sharedAudience(item?.audience));
    setConfirmDelete(false);
    setNotice("");
  }

  async function change(action: "save" | "update" | "delete" | "apply" | "share") {
    if (busy || status !== "ready") return;
    setBusy(true);
    try {
      if (action === "apply" && selected) {
        const config = decode(selected.value);
        if (config === null) throw new Error("These saved filters are no longer available.");
        onApply(config);
        setNotice(`Applied "${selected.name}".`);
        return;
      }
      if (selected?.sharedOwner) return;
      const id = action === "save" ? crypto.randomUUID() : selected?.id;
      if (!id || action === "apply") return;
      const persistence = store ?? remoteStore();
      if (action === "share") {
        await persistence.write(uid, scope, { type: action, id, revision, audience });
        setRevision(revision + 1);
        setNotice("Sharing updated.");
        return;
      } else if (action === "delete") {
        await persistence.write(uid, scope, { type: action, id, revision });
      } else {
        const config = decode(value);
        if (config === null) throw new Error("These filters cannot be saved.");
        await persistence.write(uid, scope, action === "save" ? { type: action, id, name, value: config, audience }
          : { type: action, id, name, value: config, revision });
      }
      setConfirmDelete(false);
      setSelection(action === "delete" ? "" : id);
      setRevision(action === "save" ? 1 : action === "delete" ? 0 : revision + 1);
      setName(action === "delete" ? "" : name.trim());
      if (action === "delete") setAudience(undefined);
      setNotice(action === "delete" ? "Favorite deleted." : action === "update" ? "Favorite updated." : "Favorite saved.");
    } catch (error) {
      setNotice(error instanceof Error && !("code" in error) ? error.message : "Favorites could not be saved. Check your connection and account access.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details ref={details} className={styles.favorites}>
      <summary>Favorites</summary>
      <button className={styles.close} type="button" aria-label="Close favorites" title="Close favorites"
        onClick={() => { if (details.current) { details.current.open = false; details.current.querySelector("summary")?.focus(); } }}>&times;</button>
      {status === "failed" ? <div role="alert">Favorites could not be loaded. <button type="button" onClick={() => setAttempt((n) => n + 1)}>Retry</button></div>
        : status === "loading" ? <p role="status">Loading favorites…</p> : (
        <fieldset className={styles.controls} aria-label="Manage favorites" disabled={busy}>
          <label>Saved favorite
            <select value={selected?.id ?? ""} onChange={(event) => select(event.target.value)}>
              <option value="">New favorite</option>
              {items.slice().sort((a, b) => a.name.localeCompare(b.name)).map((item) => <option key={item.id} value={item.id}>{labels.get(item.id)}</option>)}
            </select>
          </label>
          {editable && <><label>Favorite name
            <input autoComplete="off" maxLength={maxFavoriteNameLength} value={name}
              onChange={(event) => { setName(event.target.value); setConfirmDelete(false); }} />
          </label>
          <div className={styles.sharing}>
            <label className={styles.publicToggle}><input type="checkbox" checked={!!audience} aria-describedby={sharingHint}
              onChange={(event) => setAudience(event.target.checked ? "admin" : undefined)} />Public</label>
            {audience && <label>Audience
              <select value={audience} onChange={(event) => setAudience(event.target.value === "all" ? "all" : "admin")}>
                <option value="admin">Admin</option><option value="all">All</option>
              </select>
            </label>}
          </div>
          <small id={sharingHint}>Public shares only within your organization. No public link is created.</small></>}
          <div className={styles.actions}>
            {selected && <button type="button" onClick={() => change("apply")}>Apply</button>}
            {sharingChanged && <button type="button" onClick={() => change("share")}>Save sharing</button>}
            {editable && <button type="button" disabled={!name.trim() || sharingChanged} onClick={() => change(selected ? "update" : "save")}>
              {selected ? "Update favorite" : "Save favorite"}
            </button>}
            {selected && !selected.sharedOwner && !confirmDelete && <button type="button" onClick={() => setConfirmDelete(true)}>Delete</button>}
            {selected && !selected.sharedOwner && confirmDelete && <>
              <button type="button" onClick={() => change("delete")}>Confirm delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>}
          </div>
          {notice && <div role="status">{notice}</div>}
        </fieldset>
      )}
    </details>
  );
}
