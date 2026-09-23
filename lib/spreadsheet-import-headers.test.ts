import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx-js-style";
import { assessmentTemplates } from "./assessment-templates";
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

describe("spreadsheet import headers", () => {
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
});
