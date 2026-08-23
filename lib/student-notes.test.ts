import { describe, expect, it } from "vitest";
import {
  canCreateStudentNote,
  canMutateStudentNote,
  filterStudentNotesForRole
} from "./student-notes";

const notes = [
  { id: "admin", permission: "admin_only" as const, body: "Admin note" },
  { id: "shared", permission: "all" as const, body: "Shared note" }
];

describe("student note permissions", () => {
  it("keeps Admin-only notes out of the Teacher / EA view", () => {
    expect(filterStudentNotesForRole(notes, "Teacher / EA")).toEqual([notes[1]]);
  });

  it("allows Admins to view every note", () => {
    expect(filterStudentNotesForRole(notes, "Admin")).toEqual(notes);
  });

  it("prevents Teacher / EA users from creating or escalating to Admin-only", () => {
    expect(canCreateStudentNote("admin_only", "Teacher / EA")).toBe(false);
    expect(canCreateStudentNote("all", "Teacher / EA")).toBe(true);
  });

  it("prevents Teacher / EA users from editing or deleting Admin-only notes", () => {
    expect(canMutateStudentNote(notes[0], "Teacher / EA")).toBe(false);
    expect(canMutateStudentNote(notes[1], "Teacher / EA")).toBe(true);
    expect(canMutateStudentNote(notes[0], "Admin")).toBe(true);
  });
});
