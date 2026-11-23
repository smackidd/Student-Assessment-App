"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import styles from "./dashboard-picker-menu.module.css";

type Option = { id: string; label: string; searchText?: string };
type PickerProps = {
  label: string;
  summary: string;
  wide?: boolean;
  disabled?: boolean;
  options: readonly Option[];
  actions?: { label: string; input: ReactNode }[];
  renderInput: (option: Option, close: () => void) => ReactNode;
};

export function DashboardPicker({ label, summary, wide, disabled, ...items }: PickerProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  return (
    <div ref={container} className={wide ? "multi-picker" : "multi-picker dashboard-choice"}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}>
      <span>{label}</span>
      <button ref={trigger} type="button" className="picker-field-button" disabled={disabled}
        aria-label={wide ? `${label}: ${summary}` : label} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}>
        <span>{summary}</span><span className="dropdown-arrow" aria-hidden="true" />
      </button>
      {open && <DashboardPickerMenu {...items} id={id} label={label} wide={wide} close={close} />}
    </div>
  );
}

function DashboardPickerMenu({ label, id, wide, close, options, actions = [], renderInput }:
  Omit<PickerProps, "summary" | "disabled"> & { id: string; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (option: { label: string }) => option.label.toLowerCase().includes(needle);
  const visibleActions = actions.filter(matches);
  const visibleOptions = options.filter((option) => matches(option) || option.searchText?.toLowerCase().includes(needle));

  useLayoutEffect(() => {
    const menu = ref.current;
    const anchor = menu?.parentElement;
    const card = anchor?.closest(".dashboard-filters");
    if (!menu || !anchor || !card) return;
    function fit() {
      if (!menu || !anchor || !card) return;
      const bounds = card.getBoundingClientRect();
      const left = Math.max(4, bounds.left + 4);
      const right = Math.min(document.documentElement.clientWidth - 4, bounds.right - 4);
      const width = Math.min(wide ? 340 : 240, Math.max(0, right - left));
      const start = anchor.getBoundingClientRect().left;
      menu.style.width = width + "px";
      menu.style.right = "auto";
      menu.style.left = (Math.max(left, Math.min(start, right - width)) - start) + "px";
    }
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(card);
    window.addEventListener("resize", fit);
    return () => { observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [wide]);
  return (
    <div ref={ref} id={id} role="dialog" aria-label={label} className={`multi-picker-menu ${wide ? "wide" : ""} ${styles.menu}`}>
      <div className={styles.header}>
        <div className={styles.field}>
          <input ref={search} autoFocus type="search" aria-label={`Search ${label}`} placeholder="Search"
            value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") return;
              event.preventDefault();
              const inputs = results.current?.querySelectorAll<HTMLInputElement>("input:enabled");
              if (inputs?.length) inputs[event.key === "ArrowUp" ? inputs.length - 1 : 0].focus();
            }} />
          {query && <button type="button" className={styles.clear} aria-label={`Clear ${label} search`}
            onClick={() => { search.current?.focus(); setQuery(""); }}>Clear</button>}
        </div>
        <button type="button" className={styles.icon} aria-label={`Focus ${label} search`}
          title={`Search ${label}`} onClick={() => search.current?.focus()}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" />
          </svg>
        </button>
        <button type="button" className="picker-menu-close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={close}>&times;</button>
      </div>
      <div ref={results} className={styles.results} onKeyDown={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          event.target.click();
        }
      }}>
        {visibleActions.map((action) => <label className="checkbox-row select-all-row" key={action.label}>
          {action.input}{action.label}
        </label>)}
        {visibleOptions.map((option) => <label className="checkbox-row" key={option.id}>
          {renderInput(option, close)}{option.label}
        </label>)}
        {!visibleActions.length && !visibleOptions.length && <span role="status">No results</span>}
      </div>
    </div>
  );
}
