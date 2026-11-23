import type { StudentPlacement } from "./overview-state";
import type { OrfResultRow } from "./sample-results";

export function reportChartScope(rows: OrfResultRow[], placements: StudentPlacement[], schoolYears: string[],
  selectedStudentIds: string[], selectedYears: string[]) {
  const ids = new Set(selectedStudentIds);
  const years = schoolYears.filter((year) => selectedYears.includes(year));
  const selectedRows = rows.filter((row) => ids.has(row.id));
  const authorizedIds = new Set(selectedRows.map((row) => row.id));
  return {
    rows: selectedRows,
    placements: placements.filter((p) => authorizedIds.has(p.studentId) && years.includes(p.schoolYear)),
    schoolYears: years
  };
}

export function reportChartSelectionIds(value: unknown, available: readonly { id: string }[]) {
  const ids = new Set(Array.isArray(value) ? value : []);
  return available.map((item) => item.id).filter((id) => ids.has(id));
}
