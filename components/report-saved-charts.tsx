"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getFirestore } from "firebase/firestore";
import { decodeDashboardFavorite } from "@/lib/dashboard-favorite";
import type { DashboardFilters } from "@/lib/dashboard-filters";
import { firebaseApp } from "@/lib/firebase";
import { organizationId } from "@/lib/organization-auth";
import { createFavoriteStore } from "@/lib/filter-favorite-store";
import { favoriteLabels, type ListedFavorite } from "@/lib/filter-favorites";
import { reportChartSelectionIds } from "@/lib/report-saved-charts";

type ChartOption = { id: string; name: string; label: string; filters: DashboardFilters | null };
type ReportChart = ChartOption & { filters: DashboardFilters };
type Source = { key: string; status: "ready" | "failed"; items: ListedFavorite[]; ids: string[] };
const noItems: ListedFavorite[] = [];

function restoredIds(key: string, items: ListedFavorite[]) {
  try { return reportChartSelectionIds(JSON.parse(sessionStorage.getItem(key) ?? "[]"), items); }
  catch { return []; }
}

export function useReportSavedCharts(uid: string, context: Parameters<typeof decodeDashboardFavorite>[1], isAdmin: boolean) {
  const key = JSON.stringify(["report-chart-ids", organizationId, uid]);
  const subscriptionKey = JSON.stringify([key, isAdmin]);
  const [source, setSource] = useState<Source | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!uid) return;
    let active = true;
    const unsubscribe = createFavoriteStore(getFirestore(firebaseApp), organizationId).subscribe(uid, "dashboard", (items) => {
      if (!active) return;
      const restored = restoredIds(key, items);
      setSource((current) => ({ key: subscriptionKey, status: "ready", items, ids: current?.key === subscriptionKey && current.status === "ready"
        ? reportChartSelectionIds(current.ids, items) : restored }));
    }, () => {
      if (active) setSource({ key: subscriptionKey, status: "failed", items: [], ids: [] });
    }, isAdmin);
    return () => { active = false; unsubscribe(); };
  }, [uid, key, subscriptionKey, isAdmin, attempt]);

  const current = source?.key === subscriptionKey && uid ? source : null;
  useEffect(() => {
    if (current?.status !== "ready") return;
    // Persist references only; names, filters and student data require a fresh authorized snapshot.
    try {
      if (current.ids.length) sessionStorage.setItem(key, JSON.stringify(current.ids));
      else sessionStorage.removeItem(key);
    } catch { /* Selection still works when browser storage is unavailable. */ }
  }, [current, key]);

  const items = current?.items ?? noItems;
  const options = useMemo(() => {
    const labels = favoriteLabels(items);
    return items.map(({ id, name, value }) => ({
      id, name, label: labels.get(id)!, filters: decodeDashboardFavorite(value, context, "report")
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [items, context]);
  const selected = useMemo(() => options.filter((item): item is ReportChart => !!item.filters && !!current?.ids.includes(item.id)),
    [options, current?.ids]);
  return {
    options, selected, status: current?.status ?? "loading",
    retry: () => { setSource(null); setAttempt((n) => n + 1); },
    select: (ids: string[]) => setSource((s) => s?.key === subscriptionKey && s.status === "ready"
      ? { ...s, ids: reportChartSelectionIds(ids, s.items) } : s)
  };
}

export function SavedChartPicker({ charts }: { charts: ReturnType<typeof useReportSavedCharts> }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { options, selected, status, select } = charts;
  const valid = options.filter((item) => item.filters);
  const all = !!valid.length && selected.length === valid.length;
  const ids = selected.map((item) => item.id);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  return <div className="multi-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => { if (open && event.key === "Escape") { event.stopPropagation(); close(); } }}>
    <span>Saved Charts</span>
    <button className="picker-field-button" ref={trigger} aria-label="Saved Charts" aria-expanded={open}
      aria-controls={open ? "report-saved-charts" : undefined} onClick={() => setOpen(!open)} type="button">
      <span>{selected.length === 1 ? selected[0].name : selected.length ? `${selected.length} charts` : "No charts selected"}</span>
      <span className="dropdown-arrow" aria-hidden="true" />
    </button>
    {open && <div id="report-saved-charts" className="multi-picker-menu wide" role="group" aria-label="Saved Charts"
      style={{ maxWidth: "100%", overflowWrap: "anywhere" }}>
      <button type="button" className="picker-menu-close" aria-label="Close Saved Charts" onClick={close}>&times;</button>
      {status === "loading" ? <p role="status">Loading saved charts...</p>
        : status === "failed" ? <div role="alert">Saved charts could not be loaded. <button type="button" onClick={charts.retry}>Retry</button></div>
        : !options.length ? <p>No saved Dashboard charts.</p> : <>
          <label className="checkbox-row select-all-row"><input type="checkbox" disabled={!valid.length} checked={all}
            onChange={() => select(all ? [] : valid.map((item) => item.id))} />All saved charts</label>
          {options.map(({ id, label, filters }) => <label className="checkbox-row" key={id}>
            <input type="checkbox" checked={ids.includes(id)} disabled={!filters}
              onChange={() => select(ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id])} />
            {label}{!filters && " (unavailable)"}
          </label>)}
        </>}
    </div>}
  </div>;
}
