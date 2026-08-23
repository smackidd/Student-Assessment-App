import type { StudentIdentityOption } from "@/lib/overview-state";

export function addReportStudentId(selectedStudentIds: string[], studentId: string) {
  return selectedStudentIds.includes(studentId) ? selectedStudentIds : [...selectedStudentIds, studentId];
}

export function removeReportStudentId(selectedStudentIds: string[], studentId: string) {
  return selectedStudentIds.filter((selectedStudentId) => selectedStudentId !== studentId);
}

export function reconcileReportStudentIds(
  selectedStudentIds: string[],
  studentOptions: StudentIdentityOption[]
) {
  const availableStudentIds = new Set(studentOptions.map((option) => option.id));
  const seenStudentIds = new Set<string>();

  return selectedStudentIds.filter((studentId) => {
    if (!availableStudentIds.has(studentId) || seenStudentIds.has(studentId)) return false;
    seenStudentIds.add(studentId);
    return true;
  });
}

export function matchingReportStudentOptions(
  studentOptions: StudentIdentityOption[],
  selectedStudentIds: string[],
  query: string,
  limit = 8
) {
  const selectedStudentIdSet = new Set(selectedStudentIds);
  const normalizedQuery = normalizeReportStudentSearch(query);

  return studentOptions
    .filter((option) => !selectedStudentIdSet.has(option.id))
    .filter((option) => {
      if (!normalizedQuery) return true;
      return normalizeReportStudentSearch(`${option.name} ${option.detail}`).includes(normalizedQuery);
    })
    .slice(0, Math.max(0, limit));
}

function normalizeReportStudentSearch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
