import { createHash } from "node:crypto";

export type StudentSyncInput = {
  id: string;
  student: string;
};

export type SavedStudent = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  studentNumber?: string | null;
  active: boolean;
};

export type StudentUpsertRow = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName: null;
  studentNumber: string;
  active: true;
};

export type StudentSyncPlan = {
  rows: StudentUpsertRow[];
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
};

export function parseStudentSyncInput(value: unknown, maximumRows = 1_000): StudentSyncInput[] {
  if (!Array.isArray(value)) throw new Error("Student synchronization requires a student list.");
  if (value.length > maximumRows) throw new Error(`Student synchronization is limited to ${maximumRows} rows at a time.`);

  const unique = new Map<string, StudentSyncInput>();
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("A student synchronization row is invalid.");
    const candidate = item as { id?: unknown; student?: unknown };
    const id = requiredText(candidate.id, 80, "student identifier");
    const student = requiredText(candidate.student, 240, "student name");
    unique.set(id, { id, student });
  }
  return Array.from(unique.values());
}

export function buildStudentSyncPlan(
  rows: StudentSyncInput[],
  existingStudents: SavedStudent[],
  createId: (studentNumber: string) => string = stableStudentDatabaseId
): StudentSyncPlan {
  const savedByNumber = new Map(
    existingStudents.map((student) => [student.studentNumber || student.id, student])
  );
  const upserts: StudentUpsertRow[] = [];
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const name = namePartsFor(row.student);
    const saved = savedByNumber.get(row.id);
    if (saved && studentNameMatches(saved, row.student, name)) {
      skippedCount += 1;
      continue;
    }

    upserts.push({
      id: saved?.id ?? createId(row.id),
      ...name,
      studentNumber: row.id,
      active: true
    });
    if (saved) updatedCount += 1;
    else createdCount += 1;
  }

  return { rows: upserts, createdCount, updatedCount, skippedCount };
}

export function studentSyncInputBatches(rows: StudentSyncInput[], batchSize: number) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error("Student synchronization batch size is invalid.");
  const batches: StudentSyncInput[][] = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    batches.push(rows.slice(index, index + batchSize));
  }
  return batches;
}

export function studentSyncBatches(rows: StudentUpsertRow[], batchSize: number) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new Error("Student synchronization batch size is invalid.");
  const batches: StudentUpsertRow[][] = [];
  for (let index = 0; index < rows.length; index += batchSize) {
    batches.push(rows.slice(index, index + batchSize));
  }
  return batches;
}

function namePartsFor(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0], lastName: "Student", preferredName: null as null };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
    preferredName: null as null
  };
}

function studentNameMatches(
  saved: SavedStudent,
  displayName: string,
  name: { firstName: string; lastName: string }
) {
  const savedDisplayName = saved.preferredName || `${saved.firstName} ${saved.lastName}`;
  return normalize(savedDisplayName) === normalize(displayName)
    || (!saved.preferredName
      && normalize(saved.firstName) === normalize(name.firstName)
      && normalize(saved.lastName) === normalize(name.lastName));
}

function requiredText(value: unknown, maximumLength: number, label: string) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Enter a ${label}.`);
  const text = value.trim();
  if (text.length > maximumLength) throw new Error(`The ${label} is too long.`);
  return text;
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function stableStudentDatabaseId(studentNumber: string) {
  const bytes = createHash("sha256")
    .update(`student-assessment:${studentNumber}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
