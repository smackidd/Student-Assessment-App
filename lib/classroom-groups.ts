import { SUPPORTED_GRADES } from "./team-assignments";

export type ClassroomGroup = { id: string; name: string; grades: string[] };
export type ClassroomGroupInput = Omit<ClassroomGroup, "id">;

const defaults: ClassroomGroup[] = [
  { id: "team-1", name: "Team 1", grades: ["3", "4", "5", "6"] },
  { id: "team-2", name: "Team 2", grades: ["7", "8", "9"] },
  { id: "team-3", name: "Team 3", grades: ["10", "11", "12"] }
];

export function isDefaultClassroomGroup(id: string) {
  return defaults.some((group) => group.id === id);
}

export function classroomGroupInput(name: string, grades: readonly string[]): ClassroomGroupInput {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80 || /[\r\n\t]/.test(trimmed)) {
    throw new Error("Enter a group name of 1 to 80 characters on one line.");
  }
  const selected = SUPPORTED_GRADES.filter((grade) => grades.includes(grade));
  if (!selected.length || selected.length !== grades.length) {
    throw new Error("Choose one or more distinct grades from 1 to 12.");
  }
  return { name: trimmed, grades: selected };
}

// A missing default has never been changed. Only its explicit tombstone removes it.
export function resolveClassroomGroup(id: string, data?: Record<string, unknown>): ClassroomGroup | null {
  if (!data) return defaults.find((group) => group.id === id) ?? null;
  if (data.deleted === true && isDefaultClassroomGroup(id)) return null;
  if (typeof data.name !== "string" || !Array.isArray(data.grades)) throw new Error("Invalid classroom group.");
  return { id, ...classroomGroupInput(data.name, data.grades) };
}

export function resolveClassroomGroups(documents: { id: string; data: Record<string, unknown> }[]): ClassroomGroup[] {
  const groups = new Map(defaults.map((group) => [group.id, group]));
  for (const { id, data } of documents) {
    const group = resolveClassroomGroup(id, data);
    if (group) groups.set(id, group);
    else groups.delete(id);
  }
  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id));
}

export function assertGroupUnchanged(expected: ClassroomGroup | null, actual: ClassroomGroup | null) {
  if (expected?.id !== actual?.id || expected?.name !== actual?.name || expected?.grades.join(",") !== actual?.grades.join(",")) {
    throw new Error("This group changed in another session. Cancel and reopen it to use the latest version.");
  }
}
