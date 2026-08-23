import type { StudentIdentityOption } from "@/lib/overview-state";

export type StudentReportSourceRow = {
  studentId: string;
  student: string;
  year: string;
  grade: string;
  homeroom: string;
  assessmentId: string;
  assessment: string;
  roundId: string;
  window: string;
  windowColor: string;
  sectionId: string;
  section: string;
  fieldId: string;
  field: string;
  value: string;
};

export type StudentReportColumn = {
  key: string;
  year: string;
  roundId: string;
  window: string;
  windowColor: string;
  sectionId: string;
  section: string;
  fieldId: string;
  field: string;
};

export type StudentReportDataRow = {
  key: string;
  studentId: string;
  student: string;
  year: string;
  grade: string;
  homeroom: string;
  values: Record<string, string>;
};

export type StudentReportBlock = {
  assessmentId: string;
  assessmentName: string;
  columns: StudentReportColumn[];
  rows: StudentReportDataRow[];
};

export type StudentReportBlockInput = {
  assessmentId: string;
  assessmentName: string;
  rows: StudentReportSourceRow[];
};

export type StudentReportHeaderLevel = "year" | "window" | "section";

export type StudentReportHeaderGroup = {
  key: string;
  label: string;
  span: number;
  windowColor: string;
};

export type StudentReportWorksheetMerge = {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
};

export type StudentReportWorksheetBlock = {
  block: StudentReportBlock;
  titleRow: number;
  headerStartRow: number;
  dataStartRow: number;
  endRow: number;
  columnCount: number;
};

export type StudentReportWorksheetLayout = {
  rows: string[][];
  merges: StudentReportWorksheetMerge[];
  blocks: StudentReportWorksheetBlock[];
};

export const STUDENT_REPORT_NO_DATA_ID = "__student-report-no-data__";

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

export function buildStudentReportBlocks(inputs: StudentReportBlockInput[]) {
  return inputs.map(({ assessmentId, assessmentName, rows }) =>
    buildStudentReportBlock(assessmentId, assessmentName, rows)
  );
}

export function buildStudentReportBlock(
  assessmentId: string,
  assessmentName: string,
  sourceRows: StudentReportSourceRow[]
): StudentReportBlock {
  const rows = sourceRows.filter((row) => row.assessmentId === assessmentId);
  const columnsByKey = new Map<string, StudentReportColumn>();
  const yearOrder = new Map<string, number>();
  const yearsWithAssessmentColumns = new Set<string>();
  const dataRowsByKey = new Map<string, StudentReportDataRow>();

  rows.forEach((row) => {
    if (!yearOrder.has(row.year)) yearOrder.set(row.year, yearOrder.size);
    const columnKey = studentReportColumnKey(row);
    if (!columnsByKey.has(columnKey)) {
      columnsByKey.set(columnKey, {
        key: columnKey,
        year: row.year,
        roundId: row.roundId,
        window: row.window,
        windowColor: row.windowColor,
        sectionId: row.sectionId,
        section: row.section,
        fieldId: row.fieldId,
        field: row.field
      });
    }
    if (row.fieldId !== STUDENT_REPORT_NO_DATA_ID) yearsWithAssessmentColumns.add(row.year);

    const dataRowKey = studentReportDataRowKey(row);
    const dataRow = dataRowsByKey.get(dataRowKey) ?? {
      key: dataRowKey,
      studentId: row.studentId,
      student: row.student,
      year: row.year,
      grade: row.grade,
      homeroom: row.homeroom,
      values: {}
    };
    dataRow.values[columnKey] = row.value;
    dataRowsByKey.set(dataRowKey, dataRow);
  });

  return {
    assessmentId,
    assessmentName,
    columns: Array.from(columnsByKey.values()).filter(
      (column) => column.fieldId !== STUDENT_REPORT_NO_DATA_ID || !yearsWithAssessmentColumns.has(column.year)
    ).sort((left, right) => (yearOrder.get(left.year) ?? 0) - (yearOrder.get(right.year) ?? 0)),
    rows: Array.from(dataRowsByKey.values())
  };
}

export function studentReportColumnKey(
  row: Pick<StudentReportSourceRow, "assessmentId" | "year" | "roundId" | "sectionId" | "fieldId">
) {
  return [row.assessmentId, row.year, row.roundId, row.sectionId, row.fieldId].join("|");
}

export function studentReportDataRowKey(
  row: Pick<StudentReportSourceRow, "studentId" | "year" | "grade" | "homeroom">
) {
  return [row.studentId, row.year, row.grade, row.homeroom].join("|");
}

export function studentReportHeaderGroups(
  columns: StudentReportColumn[],
  level: StudentReportHeaderLevel
) {
  const groups: StudentReportHeaderGroup[] = [];

  columns.forEach((column) => {
    const group = studentReportHeaderGroup(column, level);
    const previous = groups[groups.length - 1];
    if (previous?.key === group.key) {
      previous.span += 1;
      return;
    }
    groups.push(group);
  });

  return groups;
}

export function buildStudentReportWorksheetLayout(blocks: StudentReportBlock[]): StudentReportWorksheetLayout {
  const rows: string[][] = [];
  const merges: StudentReportWorksheetMerge[] = [];
  const worksheetBlocks: StudentReportWorksheetBlock[] = [];

  blocks.forEach((block, blockIndex) => {
    const titleRow = rows.length;
    const columnCount = Math.max(4, block.columns.length + 4);
    rows.push([block.assessmentName, ...Array.from({ length: columnCount - 1 }, () => "")]);
    if (columnCount > 1) {
      merges.push({ startRow: titleRow, startColumn: 0, endRow: titleRow, endColumn: columnCount - 1 });
    }

    const headerStartRow = rows.length;
    rows.push(["Assessment Year", "", "", "", ...block.columns.map((column) => column.year)]);
    rows.push(["Assessment Window", "", "", "", ...block.columns.map((column) => column.window)]);
    rows.push(["Assessment Section", "", "", "", ...block.columns.map((column) => column.section || "General")]);
    rows.push(["Student", "Grade", "Homeroom", "Year", ...block.columns.map((column) => column.field)]);

    merges.push(
      { startRow: headerStartRow, startColumn: 0, endRow: headerStartRow, endColumn: 3 },
      { startRow: headerStartRow + 1, startColumn: 0, endRow: headerStartRow + 1, endColumn: 3 },
      { startRow: headerStartRow + 2, startColumn: 0, endRow: headerStartRow + 2, endColumn: 3 }
    );
    (["year", "window", "section"] as const).forEach((level, levelIndex) => {
      let startColumn = 4;
      studentReportHeaderGroups(block.columns, level).forEach((group) => {
        if (group.span > 1) {
          merges.push({
            startRow: headerStartRow + levelIndex,
            startColumn,
            endRow: headerStartRow + levelIndex,
            endColumn: startColumn + group.span - 1
          });
        }
        startColumn += group.span;
      });
    });

    const dataStartRow = rows.length;
    block.rows.forEach((row) => {
      rows.push([
        row.student,
        row.grade,
        row.homeroom,
        row.year,
        ...block.columns.map((column) => row.values[column.key] ?? "")
      ]);
    });
    const endRow = Math.max(dataStartRow - 1, rows.length - 1);
    worksheetBlocks.push({ block, titleRow, headerStartRow, dataStartRow, endRow, columnCount });

    if (blockIndex < blocks.length - 1) rows.push([]);
  });

  return { rows, merges, blocks: worksheetBlocks };
}

function studentReportHeaderGroup(
  column: StudentReportColumn,
  level: StudentReportHeaderLevel
): StudentReportHeaderGroup {
  if (level === "year") {
    return {
      key: column.year,
      label: column.year,
      span: 1,
      windowColor: column.windowColor
    };
  }
  if (level === "window") {
    return {
      key: [column.year, column.roundId].join("|"),
      label: column.window || "No window",
      span: 1,
      windowColor: column.windowColor
    };
  }
  return {
    key: [column.year, column.roundId, column.sectionId].join("|"),
    label: column.section || "General",
    span: 1,
    windowColor: column.windowColor
  };
}

function normalizeReportStudentSearch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}
