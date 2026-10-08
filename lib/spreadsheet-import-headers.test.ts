import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx-js-style";
import { assessmentTemplates } from "./assessment-templates";
import { assessmentValueKey, buildEntryRows } from "./assessment-entry";
import { hydrateOrfRow } from "./sample-results";
import { applySpreadsheetAssessmentValues } from "./spreadsheet-import";
import {
  columnHeadersForImportColumn,
  containsKnownAssessmentHeader,
  findImportColumnMatch,
  findStudentHeaderLocation,
  normalizeImportCellValue,
  worksheetToImportRows
} from "./spreadsheet-import-headers";

const grade3File = path.resolve(
  process.cwd(),
  "..",
  "project-resources",
  "Lindseys spreadsheets",
  "_CBM Tracking Spreadsheets 25-26",
  "For Import",
  "Grade 3 CBM 25-26 - Combined Import.xlsx"
);
const grade3LegacyFile = path.resolve(
  process.cwd(),
  "..",
  "project-resources",
  "Lindseys spreadsheets",
  "_CBM Tracking Spreadsheets 24-25",
  "For Import",
  "Grade 3 CBM 24-25 - Combined Import.xlsx"
);
const grade4LegacyFile = path.resolve(
  process.cwd(), "..", "project-resources", "Lindseys spreadsheets",
  "Assessment Tracking Spreadsheets 2023-2024", "For Import",
  "Grade 4 CBM 23-24 - Combined Import.xlsx"
);

describe("spreadsheet import headers", () => {
  it("keeps ORF WPM and CWPM in their own columns during import", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Student", "Oral Reading Fluency", null, null],
      [null, "September / Fall", null, null],
      [null, "1st passage", null, null],
      [null, "WPM", "EPM", "CWPM"],
      ["Test Student", 152, 4, 147]
    ]);
    sheet["!merges"] = [
      XLSX.utils.decode_range("A1:A4"),
      XLSX.utils.decode_range("B1:D1"),
      XLSX.utils.decode_range("B2:D2"),
      XLSX.utils.decode_range("B3:D3")
    ];

    const rows = worksheetToImportRows(sheet);
    const location = findStudentHeaderLocation(rows, assessmentTemplates);
    expect(location).toEqual({ rowIndex: 3, columnIndex: 0 });
    const matches = [1, 2, 3].map((columnIndex) =>
      findImportColumnMatch(columnHeadersForImportColumn(rows, location!.rowIndex, columnIndex), assessmentTemplates)
    );
    expect(matches.map((match) => match?.field.id)).toEqual(["wpm", "epm", "cwpm"]);

    const row = hydrateOrfRow({
      id: "orf-metric-import-test",
      student: "Test Student",
      homeroom: "11A",
      septP1Wpm: null,
      septP1Epm: null,
      septP2Wpm: null,
      septP2Epm: null,
      septP3Wpm: null,
      septP3Epm: null
    });
    const values = matches.map((match, index) => ({ match: match!, value: rows[location!.rowIndex + 1][index + 1] }));
    const context = { schoolYear: "2023-2024", grade: "11" };
    const result = applySpreadsheetAssessmentValues(row, values, context);
    const assessment = assessmentTemplates.find((template) => template.id === "orf")!;
    const round = assessment.rounds.find((candidate) => candidate.id === "fall")!;
    const section = assessment.sections!.find((candidate) => candidate.id === "passage-1")!;
    const entry = buildEntryRows([result.row], assessment, context)[0];

    expect(result.validationErrors).toEqual([]);
    expect(entry[assessmentValueKey(assessment, round, assessment.fields.find((field) => field.id === "wpm")!, section)]).toBe(152);
    expect(entry[assessmentValueKey(assessment, round, assessment.fields.find((field) => field.id === "epm")!, section)]).toBe(4);
    expect(entry[assessmentValueKey(assessment, round, assessment.fields.find((field) => field.id === "cwpm")!, section)]).toBe(147);
  });

  it("uses the metric row below a vertically merged Student header", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Student", "Oral Reading Fluency"],
      [null, "September / Fall"],
      [null, "1st passage"],
      [null, "WPM"],
      ["Test Student", 38]
    ]);
    sheet["!merges"] = [XLSX.utils.decode_range("A1:A4")];

    const rows = worksheetToImportRows(sheet);
    const location = findStudentHeaderLocation(rows, assessmentTemplates);
    expect(location).toEqual({ rowIndex: 3, columnIndex: 0 });
    const match = findImportColumnMatch(columnHeadersForImportColumn(rows, location!.rowIndex, 1), assessmentTemplates);
    expect(match && { assessment: match.assessment.id, round: match.round.id, section: match.section?.id, field: match.field.id })
      .toEqual({ assessment: "orf", round: "fall", section: "passage-1", field: "wpm" });
    expect(rows[location!.rowIndex + 1][1]).toBe(38);
  });

  it("still accepts a single-row names-only roster", () => {
    const rows = [["Student Name", "Homeroom"], ["Test Student", "3A"]];
    expect(findStudentHeaderLocation(rows, assessmentTemplates)).toEqual({ rowIndex: 0, columnIndex: 0 });
    expect(containsKnownAssessmentHeader(rows.slice(0, 1), assessmentTemplates)).toBe(false);
  });

  it("identifies known assessment headers when their value columns do not map", () => {
    expect(containsKnownAssessmentHeader([["Student", "Oral Reading Fluency"]], assessmentTemplates)).toBe(true);
  });

  it("treats explicit n/a markers as missing without changing percentile-range text", () => {
    expect(normalizeImportCellValue(" n/A ")).toBeNull();
    expect(normalizeImportCellValue("1-19%")).toBe("1-19%");
  });

  it("converts only Excel percent-formatted ORF percentile fractions to rank points", () => {
    const orf = assessmentTemplates.find((template) => template.id === "orf")!;
    const quickWrite = assessmentTemplates.find((template) => template.id === "quick-write")!;
    const orfMatch = { assessment: orf, round: orf.rounds[0], field: orf.fields.find((field) => field.id === "percentile-fall")!, fieldName: "test" };
    const quickWriteMatch = { assessment: quickWrite, round: quickWrite.rounds[0], field: quickWrite.fields.find((field) => field.id === "quick-write-percentile")!, fieldName: "test" };
    const persistedOrfMatch = { ...orfMatch, field: { ...orfMatch.field, id: "orf-ile-5-fall", slug: "ile-fall" } };
    expect(normalizeImportCellValue(0.11, orfMatch, "0%")).toBe(11);
    expect(normalizeImportCellValue(0.11, persistedOrfMatch, "0%")).toBe(11);
    expect(normalizeImportCellValue(0.17, orfMatch, "0.0%;[Red]-0.0% ")).toBe(17);
    expect(normalizeImportCellValue(1, orfMatch, "0")).toBe(1);
    expect(normalizeImportCellValue(0.11, orfMatch, "0")).toBe(0.11);
    expect(normalizeImportCellValue(0.11, quickWriteMatch, "0%")).toBe(0.11);
    expect(normalizeImportCellValue(0.11, orfMatch, '0"%"')).toBe(0.11);
  });

  it.skipIf(!existsSync(grade4LegacyFile))("reads Grade 4 23-24 ORF percentiles in displayed points", () => {
    const workbook = XLSX.readFile(grade4LegacyFile, { cellNF: true });
    const sheet = workbook.Sheets["Overview"];
    const rows = worksheetToImportRows(sheet);
    const header = findStudentHeaderLocation(rows, assessmentTemplates)!;
    expect(header).toEqual({ rowIndex: 3, columnIndex: 1 });
    let checked = 0;
    for (let rowNumber = 5; rowNumber <= 16; rowNumber += 1) {
      for (const column of [12, 23, 34]) {
        const match = findImportColumnMatch(columnHeadersForImportColumn(rows, header.rowIndex, column), assessmentTemplates)!;
        const address = XLSX.utils.encode_cell({ r: rowNumber - 1, c: column });
        const cell = sheet[address];
        expect(match.assessment.id).toBe("orf");
        expect(match.field.calculationKey).toMatch(/^orf_percentile/);
        expect(cell.z).toContain("%");
        expect(normalizeImportCellValue(rows[rowNumber - 1][column], match, cell.z)).toBe(Number((cell.v * 100).toFixed(10)));
        checked += 1;
      }
    }
    expect(checked).toBe(36);
    for (const [column, expected] of [[12, 11], [23, 17], [34, 8]] as const) {
      const match = findImportColumnMatch(columnHeadersForImportColumn(rows, header.rowIndex, column), assessmentTemplates)!;
      const address = XLSX.utils.encode_cell({ r: 4, c: column });
      expect(sheet[address].v).toBe(expected / 100);
      expect(normalizeImportCellValue(rows[4][column], match, sheet[address].z)).toBe(expected);
    }
  });

  it.skipIf(!existsSync(grade3File))("maps a real Grade 3 workbook score below the four header rows", () => {
    const workbook = XLSX.readFile(grade3File);
    const rows = worksheetToImportRows(workbook.Sheets["Overview"]);
    const location = findStudentHeaderLocation(rows, assessmentTemplates);
    expect(location).toEqual({ rowIndex: 3, columnIndex: 1 });
    const match = findImportColumnMatch(columnHeadersForImportColumn(rows, location!.rowIndex, 2), assessmentTemplates);
    expect(match && { assessment: match.assessment.id, round: match.round.id, section: match.section?.id, field: match.field.id })
      .toEqual({ assessment: "orf", round: "fall", section: "passage-1", field: "wpm" });
    expect(rows[location!.rowIndex + 1][2]).toBe(38);
    expect(rows.slice(location!.rowIndex + 1).every((row) => row[location!.columnIndex] !== "Student")).toBe(true);
    const matchedAssessmentIds = new Set(
      rows[location!.rowIndex]
        .map((_cell, columnIndex) => findImportColumnMatch(columnHeadersForImportColumn(rows, location!.rowIndex, columnIndex), assessmentTemplates))
        .filter((item) => item !== null)
        .map((item) => item.assessment.id)
    );
    expect(matchedAssessmentIds).toEqual(new Set(["orf", "quick-write", "cc3", "ab-ed-numeracy"]));

    const matches = rows[location!.rowIndex].map((_cell, columnIndex) =>
      findImportColumnMatch(columnHeadersForImportColumn(rows, location!.rowIndex, columnIndex), assessmentTemplates)
    );
    let importedValues = 0;
    for (const [index, cells] of rows.slice(location!.rowIndex + 1).entries()) {
      if (!cells[location!.columnIndex]) continue;
      const row = hydrateOrfRow({
        id: `grade-3-import-${index}`,
        student: "Test Student",
        homeroom: "3A",
        septP1Wpm: null,
        septP1Epm: null,
        septP2Wpm: null,
        septP2Epm: null,
        septP3Wpm: null,
        septP3Epm: null
      });
      const values = matches.flatMap((match, columnIndex) => match ? [{ match, value: normalizeImportCellValue(cells[columnIndex] ?? null) }] : []);
      const result = applySpreadsheetAssessmentValues(row, values, { schoolYear: "2025-2026", grade: "3" });
      expect(result.validationErrors).toEqual([]);
      importedValues += result.importedValueCount;
    }
    expect(importedValues).toBeGreaterThan(0);
  });

  it.skipIf(!existsSync(grade3LegacyFile))("imports Grade 3 24-25 ORF scores and preserves source Quick Write percentile labels", () => {
    const workbook = XLSX.readFile(grade3LegacyFile);
    const rows = worksheetToImportRows(workbook.Sheets["Overview"]);
    const location = findStudentHeaderLocation(rows, assessmentTemplates);
    expect(location).toEqual({ rowIndex: 3, columnIndex: 1 });
    const matches = rows[location!.rowIndex].map((_cell, columnIndex) =>
      findImportColumnMatch(columnHeadersForImportColumn(rows, location!.rowIndex, columnIndex), assessmentTemplates)
    );
    const context = { schoolYear: "2024-2025", grade: "3" };
    const quickWrite = assessmentTemplates.find((template) => template.id === "quick-write")!;
    let orfPercentiles = 0;
    let quickWritePercentiles = 0;

    for (const [index, cells] of rows.slice(location!.rowIndex + 1).entries()) {
      if (!cells[location!.columnIndex]) continue;
      const row = hydrateOrfRow({
        id: `grade-3-legacy-import-${index}`,
        student: "Test Student",
        homeroom: "3A",
        septP1Wpm: null,
        septP1Epm: null,
        septP2Wpm: null,
        septP2Epm: null,
        septP3Wpm: null,
        septP3Epm: null
      });
      const values = matches.flatMap((match, columnIndex) =>
        match ? [{ match, value: normalizeImportCellValue(cells[columnIndex] ?? null) }] : []
      );
      const result = applySpreadsheetAssessmentValues(row, values, context);
      expect(result.validationErrors).toEqual([]);

      const quickWriteEntry = buildEntryRows([result.row], quickWrite, context)[0];
      for (const { match, value } of values) {
        if (value === null || value === "" || match.field.name !== "%ile") continue;
        if (match.assessment.id === "orf") orfPercentiles += 1;
        if (match.assessment.id === "quick-write") {
          quickWritePercentiles += 1;
          expect(quickWriteEntry[assessmentValueKey(quickWrite, match.round, match.field)]).toBe(value);
        }
      }
    }

    expect(orfPercentiles).toBe(34);
    expect(quickWritePercentiles).toBe(36);
  });
});
