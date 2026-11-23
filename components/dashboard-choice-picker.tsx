"use client";

import { useId } from "react";
import { DashboardPicker } from "./dashboard-picker-menu";

export function DashboardChoicePicker({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: ReadonlyArray<{ id: string; label: string }>;
  onChange: (id: string) => void;
}) {
  const id = useId();
  const current = options.find((option) => option.id === value);

  return (
    <DashboardPicker label={label} summary={current?.label ?? "Choose"} options={options} disabled={!options.length}
      renderInput={(option, close) => <input type="radio" name={id} checked={value === option.id}
        onChange={() => { onChange(option.id); close(); }}
        onClick={() => { if (value === option.id) close(); }} />} />
  );
}
