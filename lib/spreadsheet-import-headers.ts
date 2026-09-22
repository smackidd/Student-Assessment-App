import * as XLSX from "xlsx-js-style";
import type {
  AssessmentFieldTemplate,
  AssessmentRoundTemplate,
  AssessmentSectionTemplate,
  AssessmentTemplate
} from "./assessment-templates";
import { assessmentValueKey, sectionsForAssessmentRound } from "./assessment-entry";

export type ImportColumnMatch = {
  assessment: AssessmentTemplate;
  round: AssessmentRoundTemplate;
  field: AssessmentFieldTemplate;
  section?: AssessmentSectionTemplate;
  fieldName: string;
};

const studentHeaderLabels = new Set(["studentname", "student", "name", "studentfullname", "fullname"]);
const homeroomHeaderLabels = new Set(["homeroom", "home room", "hr", "classroom", "class"]);

export function normalizedImportLabel(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function normalizeImportCellValue(value: string | number | boolean | Date | null) {
  // The CBM workbooks use n/a to mean a measurement was not available.
  return typeof value === "string" && value.trim().toLowerCase() === "n/a" ? null : value;
}

export function worksheetToImportRows(worksheet: XLSX.WorkSheet) {
  const range = XLSX.utils.decode_range(String(worksheet["!ref"] ?? "A1:A1"));
  const merges = (worksheet["!merges"] as XLSX.Range[] | undefined) ?? [];
  const rows: Array<Array<string | number | boolean | Date | null>> = [];

  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const nextRow: Array<string | number | boolean | Date | null> = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const mergedRange = merges.find((merge) => row >= merge.s.r && row <= merge.e.r && column >= merge.s.c && column <= merge.e.c);
      const source = mergedRange?.s ?? { r: row, c: column };
      const cell = worksheet[XLSX.utils.encode_cell(source)];
      nextRow.push((cell?.v ?? null) as string | number | boolean | Date | null);
    }
    rows.push(nextRow);
  }

  return rows;
}

export function findStudentHeaderLocation(rows: Array<Array<unknown>>, templates: AssessmentTemplate[]) {
  let bestLocation: { rowIndex: number; columnIndex: number } | null = null;
  let bestMatchCount = -1;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 12); rowIndex += 1) {
    const row = rows[rowIndex];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (!studentHeaderLabels.has(normalizedImportLabel(row[columnIndex]))) continue;

      const homeroomColumnIndex = findHomeroomColumnIndex(row);
      const matchCount = row.reduce<number>((count, _cell, candidateColumn) => {
        if (candidateColumn === columnIndex || candidateColumn === homeroomColumnIndex) return count;
        const headers = columnHeadersForImportColumn(rows, rowIndex, candidateColumn);
        return count + (findImportColumnMatch(headers, templates) ? 1 : 0);
      }, 0);
      if (matchCount > bestMatchCount) {
        bestLocation = { rowIndex, columnIndex };
        bestMatchCount = matchCount;
      }
    }
  }

  return bestLocation;
}

export function findHomeroomColumnIndex(headerRow: Array<unknown>) {
  return headerRow.findIndex((cell) => homeroomHeaderLabels.has(normalizedImportLabel(cell)));
}

export function columnHeadersForImportColumn(rows: Array<Array<unknown>>, headerRowIndex: number, columnIndex: number) {
  const firstHeaderRow = Math.max(0, headerRowIndex - 3);
  return rows
    .slice(firstHeaderRow, headerRowIndex + 1)
    .map((row, index) => String(headerValueForImportColumn(row, columnIndex, index < 2) ?? "").trim())
    .filter(Boolean);
}

function headerValueForImportColumn(row: Array<unknown>, columnIndex: number, allowForwardFill: boolean) {
  const directValue = row[columnIndex];
  if (String(directValue ?? "").trim() || !allowForwardFill) return directValue;

  for (let index = columnIndex - 1; index >= 0; index -= 1) {
    const candidate = row[index];
    if (String(candidate ?? "").trim()) return candidate;
  }

  return directValue;
}

export function findImportColumnMatch(headers: string[], templates: AssessmentTemplate[]): ImportColumnMatch | null {
  if (!headers.length) return null;
  const normalizedHeaders = headers.map(normalizedImportLabel).filter(Boolean);

  for (const assessment of templates) {
    if (!looseHeaderLabelMatch(normalizedHeaders, [assessment.name, assessment.id])) continue;
    for (const round of assessment.rounds) {
      if (!looseHeaderLabelMatch(normalizedHeaders, [round.label, round.month, windowIndicatorForRound(round), round.id])) continue;
      const sectionsForRound = sectionsForAssessmentRound(assessment, round);
      for (const field of assessment.fields) {
        if (field.roundIds?.length && !field.roundIds.includes(round.id)) continue;
        if (!fieldHeaderLabelMatch(normalizedHeaders, field)) continue;
        const fieldSections = sectionsForRound.filter((section) => field.sectionIds?.includes(section.id));
        if (!fieldSections.length) {
          return { assessment, round, field, fieldName: assessmentValueKey(assessment, round, field) };
        }
        const section = fieldSections.find((candidate) => exactHeaderLabelMatch(normalizedHeaders, [candidate.name, candidate.id]));
        if (section) return { assessment, round, field, section, fieldName: assessmentValueKey(assessment, round, field, section) };
      }
    }
  }

  return null;
}

export function containsKnownAssessmentHeader(rows: Array<Array<unknown>>, templates: AssessmentTemplate[]) {
  return rows.some((row) => row.some((cell) => {
    const normalized = normalizedImportLabel(cell);
    return Boolean(normalized && templates.some((assessment) => exactHeaderLabelMatch([normalized], [assessment.name, assessment.id])));
  }));
}

function windowIndicatorForRound(round: AssessmentRoundTemplate) {
  const labelParts = round.label.split("/");
  return labelParts.length > 1 ? labelParts[labelParts.length - 1].trim() : round.month;
}

function exactHeaderLabelMatch(normalizedHeaders: string[], labels: Array<string | undefined>) {
  return labels.some((label) => {
    const normalizedLabel = normalizedImportLabel(label);
    return Boolean(normalizedLabel && normalizedHeaders.includes(normalizedLabel));
  });
}

function fieldHeaderLabelMatch(normalizedHeaders: string[], field: AssessmentFieldTemplate) {
  const compactHeaderPath = normalizedHeaders.join("");
  return [field.name, field.slug, field.id].some((label) => {
    const normalizedLabel = normalizedImportLabel(label);
    if (!normalizedLabel) return false;
    return normalizedHeaders.includes(normalizedLabel) || compactHeaderPath.includes(normalizedLabel);
  });
}

function looseHeaderLabelMatch(normalizedHeaders: string[], labels: Array<string | undefined>) {
  const compactHeaderPath = normalizedHeaders.join("");
  return labels.some((label) => {
    const normalizedLabel = normalizedImportLabel(label);
    if (!normalizedLabel) return false;
    return (
      normalizedHeaders.includes(normalizedLabel) ||
      compactHeaderPath.includes(normalizedLabel) ||
      normalizedHeaders.some((header) => header.includes(normalizedLabel) || normalizedLabel.includes(header))
    );
  });
}
