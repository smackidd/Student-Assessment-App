import type { OrfResultRow } from "@/lib/sample-results";

export type PersistedStudent = {
  id: string;
  firstName: string;
  lastName: string;
  preferredName?: string | null;
  studentNumber?: string | null;
  active: boolean;
};

export type StudentNameVariables = {
  firstName: string;
  lastName: string;
  preferredName: null;
};

export type StudentSaveAction =
  | {
      kind: "create";
      studentNumber: string;
      variables: StudentNameVariables & { studentNumber: string };
    }
  | {
      kind: "update";
      studentNumber: string;
      variables: StudentNameVariables & { studentId: string };
    };

export type StudentSavePlan = {
  actions: StudentSaveAction[];
  skippedCount: number;
};

export function buildStudentSavePlan(
  rows: Array<Pick<OrfResultRow, "id" | "student">>,
  existingStudents: PersistedStudent[]
): StudentSavePlan {
  const savedStudentsByNumber = new Map(
    existingStudents.map((student) => [student.studentNumber || student.id, student])
  );
  const uniqueRows = Array.from(new Map(rows.map((row) => [row.id, row])).values());
  const actions: StudentSaveAction[] = [];
  let skippedCount = rows.length - uniqueRows.length;

  for (const row of uniqueRows) {
    const variables = namePartsFor(row.student);
    const savedStudent = savedStudentsByNumber.get(row.id);

    if (!savedStudent) {
      actions.push({
        kind: "create",
        studentNumber: row.id,
        variables: { ...variables, studentNumber: row.id }
      });
      continue;
    }

    if (studentNameMatches(savedStudent, row.student, variables)) {
      skippedCount += 1;
      continue;
    }

    actions.push({
      kind: "update",
      studentNumber: row.id,
      variables: { ...variables, studentId: savedStudent.id }
    });
  }

  return { actions, skippedCount };
}

export async function runInBatches<TItem, TResult>(
  items: TItem[],
  batchSize: number,
  worker: (item: TItem) => Promise<TResult>
) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new RangeError("Batch size must be a positive whole number.");
  }

  const results: TResult[] = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    results.push(...(await Promise.all(batch.map(worker))));
  }
  return results;
}

export function displayNameFor(student: PersistedStudent) {
  return student.preferredName || [student.firstName, student.lastName].filter(Boolean).join(" ").trim() || "Saved Student";
}

export function namePartsFor(displayName: string): StudentNameVariables {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { firstName: "New", lastName: "Student", preferredName: null };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "Student", preferredName: null };
  }
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1],
    preferredName: null
  };
}

function studentNameMatches(
  savedStudent: PersistedStudent,
  displayName: string,
  variables: StudentNameVariables
) {
  if (normalizeName(displayNameFor(savedStudent)) === normalizeName(displayName)) return true;
  return !savedStudent.preferredName &&
    normalizeName(savedStudent.firstName) === normalizeName(variables.firstName) &&
    normalizeName(savedStudent.lastName) === normalizeName(variables.lastName);
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}
