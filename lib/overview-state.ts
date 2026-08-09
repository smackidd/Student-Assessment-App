import type { OrfResultRow } from "@/lib/sample-results";

export type StudentPlacement = {
  studentId: string;
  schoolYear: string;
  grade: string;
  homeroom: string;
};

export type StudentIdentityOption = {
  id: string;
  name: string;
  detail: string;
};

export type StudentSearchOption = {
  key: string;
  studentId: string;
  name: string;
  schoolYear: string;
  grade: string;
  homeroom: string;
  label: string;
};

export function parseOverviewStudentCount(rawValue: string) {
  if (!/^\d+$/.test(rawValue)) return null;
  const count = Number(rawValue);
  return Number.isSafeInteger(count) && count >= 1 && count <= 40 ? count : null;
}

type DeleteSchoolYearInput = {
  rows: OrfResultRow[];
  placements: StudentPlacement[];
  schoolYears: string[];
  lockedYears: string[];
  selectedYear: string;
  yearToDelete: string;
};

export type DeleteSchoolYearResult =
  | { status: "deleted"; rows: OrfResultRow[]; placements: StudentPlacement[]; schoolYears: string[]; lockedYears: string[]; selectedYear: string }
  | { status: "blocked"; reason: "locked" | "last-year" | "missing" };

export function deleteSchoolYearFromOverview(input: DeleteSchoolYearInput): DeleteSchoolYearResult {
  if (!input.schoolYears.includes(input.yearToDelete)) return { status: "blocked", reason: "missing" };
  if (input.lockedYears.includes(input.yearToDelete)) return { status: "blocked", reason: "locked" };
  if (input.schoolYears.length <= 1) return { status: "blocked", reason: "last-year" };

  const deletedIndex = input.schoolYears.indexOf(input.yearToDelete);
  const schoolYears = input.schoolYears.filter((year) => year !== input.yearToDelete);
  const selectedYear =
    input.selectedYear === input.yearToDelete
      ? schoolYears[Math.min(deletedIndex, schoolYears.length - 1)]
      : input.selectedYear;
  const assessmentPrefix = `${slugForAssessmentKey(`year_${input.yearToDelete}`)}__`;

  return {
    status: "deleted",
    rows: input.rows.map((row) => removeAssessmentValuesWithPrefix(row, assessmentPrefix)),
    placements: input.placements.filter((placement) => placement.schoolYear !== input.yearToDelete),
    schoolYears,
    lockedYears: input.lockedYears.filter((year) => year !== input.yearToDelete),
    selectedYear
  };
}

type MoveStudentInput = {
  placements: StudentPlacement[];
  studentId: string;
  schoolYear: string;
  grade: string;
  homeroom: string;
};

export type MoveStudentResult =
  | { status: "moved"; placements: StudentPlacement[] }
  | { status: "blocked"; reason: "missing-placement" | "missing-homeroom" | "same-homeroom" };

export function moveStudentToExistingHomeroom(input: MoveStudentInput): MoveStudentResult {
  const homeroom = input.homeroom.trim();
  const placement = input.placements.find(
    (candidate) =>
      candidate.studentId === input.studentId &&
      candidate.schoolYear === input.schoolYear &&
      candidate.grade === input.grade
  );
  if (!placement) return { status: "blocked", reason: "missing-placement" };
  if (placement.homeroom === homeroom) return { status: "blocked", reason: "same-homeroom" };

  const homeroomExists = input.placements.some(
    (candidate) =>
      candidate.schoolYear === input.schoolYear &&
      candidate.grade === input.grade &&
      candidate.homeroom === homeroom
  );
  if (!homeroomExists) return { status: "blocked", reason: "missing-homeroom" };

  return {
    status: "moved",
    placements: input.placements.map((candidate) =>
      candidate === placement ? { ...candidate, homeroom } : candidate
    )
  };
}

type ReassignStudentInput = {
  rows: OrfResultRow[];
  placements: StudentPlacement[];
  placeholderId: string;
  existingStudentId: string;
  schoolYear: string;
  grade: string;
};

export type ReassignStudentResult =
  | { status: "reassigned"; rows: OrfResultRow[]; placements: StudentPlacement[] }
  | { status: "blocked"; reason: "same-student" | "missing-placeholder" | "missing-student" | "already-placed" };

export function reassignPlaceholderToExistingStudent(input: ReassignStudentInput): ReassignStudentResult {
  if (input.placeholderId === input.existingStudentId) return { status: "blocked", reason: "same-student" };
  if (!input.rows.some((row) => row.id === input.existingStudentId)) return { status: "blocked", reason: "missing-student" };

  const targetPlacement = input.placements.find(
    (placement) =>
      placement.studentId === input.placeholderId &&
      placement.schoolYear === input.schoolYear &&
      placement.grade === input.grade
  );
  if (!targetPlacement) return { status: "blocked", reason: "missing-placeholder" };

  const alreadyPlaced = input.placements.some(
    (placement) => placement.studentId === input.existingStudentId && placement.schoolYear === input.schoolYear
  );
  if (alreadyPlaced) return { status: "blocked", reason: "already-placed" };

  const placements = input.placements.map((placement) =>
    placement === targetPlacement ? { ...placement, studentId: input.existingStudentId } : placement
  );
  const placeholderStillPlaced = placements.some((placement) => placement.studentId === input.placeholderId);

  return {
    status: "reassigned",
    rows: placeholderStillPlaced ? input.rows : input.rows.filter((row) => row.id !== input.placeholderId),
    placements
  };
}

export function buildStudentIdentityOptions(rows: OrfResultRow[], placements: StudentPlacement[]): StudentIdentityOption[] {
  const contextsByStudent = new Map<string, string[]>();
  placements.forEach((placement) => {
    const context = `${placement.schoolYear}, Grade ${placement.grade}, ${placement.homeroom}`;
    contextsByStudent.set(placement.studentId, [...(contextsByStudent.get(placement.studentId) ?? []), context]);
  });

  return rows
    .map((row) => ({
      id: row.id,
      name: cleanStudentName(row.student),
      detail: Array.from(new Set(contextsByStudent.get(row.id) ?? [])).sort().reverse().join("; ") || "Not currently assigned"
    }))
    .filter((option) => option.name)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

export function buildStudentSearchOptions(rows: OrfResultRow[], placements: StudentPlacement[]): StudentSearchOption[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return placements
    .map((placement) => {
      const row = rowsById.get(placement.studentId);
      if (!row) return null;
      const name = cleanStudentName(row.student);
      if (!name) return null;
      const key = [placement.studentId, placement.schoolYear, placement.grade, placement.homeroom].join("|");
      return {
        key,
        studentId: placement.studentId,
        name,
        schoolYear: placement.schoolYear,
        grade: placement.grade,
        homeroom: placement.homeroom,
        label: `${name} - ${placement.schoolYear}, Grade ${placement.grade}, ${placement.homeroom}`
      };
    })
    .filter((option): option is StudentSearchOption => Boolean(option))
    .sort((left, right) => left.name.localeCompare(right.name) || right.schoolYear.localeCompare(left.schoolYear));
}

function removeAssessmentValuesWithPrefix(row: OrfResultRow, prefix: string): OrfResultRow {
  if (!row.assessmentValues || !Object.keys(row.assessmentValues).some((key) => key.startsWith(prefix))) return row;
  return {
    ...row,
    assessmentValues: Object.fromEntries(
      Object.entries(row.assessmentValues).filter(([key]) => !key.startsWith(prefix))
    )
  };
}

function cleanStudentName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function slugForAssessmentKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "untitled";
}
