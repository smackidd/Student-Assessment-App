"use client";

import { DashboardPicker } from "./dashboard-picker-menu";

export function DashboardFilterPicker({ label, allLabel, options, selected, emptyMeansAll, explicitAllOnly, automatic, onAutomatic, onChange }: {
  label: string; allLabel: string; options: { id: string; label: string; searchText?: string }[]; selected: string[];
  emptyMeansAll?: boolean; explicitAllOnly?: boolean; automatic?: boolean; onAutomatic?: () => void; onChange: (ids: string[]) => void;
}) {
  const all = emptyMeansAll ? !selected.length : options.length > 0 && options.every(({ id }) => selected.includes(id));
  const summary = automatic ? `Auto (${selected.length})` : all ? allLabel : selected.length === 1
    ? options.find((item) => item.id === selected[0])?.label ?? "Unavailable"
    : `${selected.length} ${label.toLowerCase()}`;
  const actions = [];
  if (onAutomatic) actions.push({
    label: "Automatic (years with data)",
    input: <input checked={!!automatic} type="checkbox" onChange={() => automatic ? onChange(selected) : onAutomatic()} />
  });
  actions.push({
    label: allLabel,
    input: <input checked={all && !automatic} type="checkbox" disabled={!options.length && !selected.length}
      onChange={() => onChange(emptyMeansAll || (all && !automatic) ? [] : options.map(({ id }) => id))} />
  });

  return <DashboardPicker label={label} summary={summary} wide options={options} actions={actions}
    renderInput={({ id }) => {
      const checked = selected.includes(id);
      const lastExplicit = explicitAllOnly && checked && selected.length === 1;
      return <input type="checkbox" checked={checked} aria-disabled={lastExplicit || undefined}
        title={lastExplicit ? `Use ${allLabel} to clear this selection` : undefined}
        onChange={() => {
          if (lastExplicit) return;
          const next = checked ? selected.filter((item) => item !== id) : [...selected, id];
          if (next.length || emptyMeansAll || onAutomatic) onChange(next);
        }} />;
    }} />;
}
