import type { UserRole } from "@/lib/organization-auth";

export type StudentNotePermission = "admin_only" | "all";

type NotePermissionRecord = {
  permission: StudentNotePermission;
};

export function canViewStudentNote(note: NotePermissionRecord, role: UserRole) {
  return role === "Admin" || note.permission === "all";
}

export function filterStudentNotesForRole<T extends NotePermissionRecord>(notes: T[], role: UserRole) {
  return notes.filter((note) => canViewStudentNote(note, role));
}

export function canCreateStudentNote(permission: StudentNotePermission, role: UserRole) {
  return role === "Admin" || permission === "all";
}

export function canMutateStudentNote(note: NotePermissionRecord, role: UserRole) {
  return role === "Admin" || note.permission === "all";
}
