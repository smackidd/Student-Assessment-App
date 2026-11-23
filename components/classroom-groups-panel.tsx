"use client";

import { useState } from "react";
import { classroomGroupInput, type ClassroomGroup } from "@/lib/classroom-groups";
import { saveClassroomGroup, type ClassroomGroupList } from "@/lib/classroom-group-store";
import { SUPPORTED_GRADES } from "@/lib/team-assignments";
import styles from "./classroom-groups-panel.module.css";

type Editor = { mode: "create" | "edit" | "delete"; original: ClassroomGroup | null; name: string; grades: string[] };

export function ClassroomGroupsPanel({ list, onChanged }: {
  list: ClassroomGroupList;
  onChanged: (action: string, name: string, description: string) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function open(mode: Editor["mode"], original: ClassroomGroup | null = null) {
    setError("");
    setMessage("");
    setEditor({ mode, original, name: original?.name ?? "", grades: original?.grades ?? [] });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || busy || list.status !== "ready") return;
    setBusy(true);
    setError("");
    try {
      const next = editor.mode === "delete" ? null : classroomGroupInput(editor.name, editor.grades);
      await saveClassroomGroup(editor.original, next);
      const action = editor.mode === "create" ? "Created" : editor.mode === "edit" ? "Updated" : "Deleted";
      const name = next?.name ?? editor.name;
      onChanged(action + " classroom group", name, next ? "Grades: " + next.grades.join(", ") : "Removed the classroom group.");
      setMessage(action + " " + name + ".");
      setEditor(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the classroom group.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel team-panel" aria-label="Classroom Groups">
      <div className="panel-heading with-action">
        <h2>Classroom Groups</h2>
        <button className="small-action" disabled={list.status !== "ready" || !!editor} onClick={() => open("create")} type="button">Add group</button>
      </div>
      {list.status === "loading" && <p role="status">Loading classroom groups...</p>}
      {list.status === "error" && <p role="alert">Classroom groups could not be loaded. <button type="button" className="small-action ghost" onClick={list.retry}>Retry</button></p>}
      {list.status === "ready" && (
        <>
          {list.groups.length === 0 && <p>No classroom groups.</p>}
          <ul className={styles.list}>
            {list.groups.map((group) => (
              <li key={group.id} className={styles.row}>
                <div className={styles.label}><strong>{group.name}</strong><div>Grades: {group.grades.join(", ")}</div></div>
                <button type="button" className="small-action ghost" disabled={!!editor} onClick={() => open("edit", group)} aria-label={`Edit ${group.name}`}>Edit</button>
                <button type="button" className="danger-action" disabled={!!editor} onClick={() => open("delete", group)} aria-label={`Delete ${group.name}`}>Delete</button>
              </li>
            ))}
          </ul>
          {editor && (
            <form className={styles.editor} onSubmit={submit}>
              <h3>{editor.mode === "delete" ? `Delete ${editor.name}?` : editor.mode === "create" ? "Add classroom group" : "Edit classroom group"}</h3>
              {editor.mode === "delete" ? <p>This removes the shared group. Student records and staff assignments are unchanged.</p> : (
                <>
                  <label>Group name<input autoFocus disabled={busy} required maxLength={80} value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} /></label>
                  <fieldset disabled={busy} className={styles.grades}>
                    <legend>Grades</legend>
                    {SUPPORTED_GRADES.map((grade) => (
                      <label key={grade}><input type="checkbox" checked={editor.grades.includes(grade)} onChange={(e) => setEditor({ ...editor, grades: e.target.checked ? [...editor.grades, grade] : editor.grades.filter((item) => item !== grade) })} />{grade}</label>
                    ))}
                  </fieldset>
                </>
              )}
              {error && <p role="alert">{error}</p>}
              <div className={styles.actions}>
                <button className="small-action ghost" type="button" disabled={busy} onClick={() => setEditor(null)}>Cancel</button>
                <button className={editor.mode === "delete" ? "danger-action" : "small-action"} type="submit" disabled={busy}>{busy ? "Saving..." : editor.mode === "delete" ? "Delete group" : "Save group"}</button>
              </div>
            </form>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
