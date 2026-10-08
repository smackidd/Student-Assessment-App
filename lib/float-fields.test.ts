import { describe, expect, it } from "vitest";
import { parseWorkspaceState } from "../functions/src/workspace-scope";
import { assessmentValueKey, buildEntryRows, buildOverviewRows, updateAssessmentRowFromTableEdit, validateAssessmentValue } from "./assessment-entry";
import { emptyCustomTemplate, normalizeAssessmentTemplates, type AssessmentFieldTemplate } from "./assessment-templates";
import { averageDashboardValues } from "./dashboard-charts";
import { hydrateOrfRow } from "./sample-results";
import { applySpreadsheetAssessmentValues } from "./spreadsheet-import";
import { buildStudentReportBlocks, buildStudentReportWorksheetLayout } from "./student-report";

const field: AssessmentFieldTemplate = {
  id: "decimal-result", name: "Decimal result", slug: "decimal_result", dataType: "float",
  isRequired: false, isCalculated: false, visibility: "evaluators"
};
const assessment = { ...emptyCustomTemplate, id: "float-assessment", name: "Float assessment", fields: [field] };
const round = assessment.rounds[0];
const context = { schoolYear: "2025-2026", grade: "4" };
const fieldName = assessmentValueKey(assessment, round, field);
function emptyRow() {
  return hydrateOrfRow({ id: "float-student", student: "Example Student", homeroom: "4A",
    septP1Wpm: null, septP1Epm: null, septP2Wpm: null, septP2Epm: null, septP3Wpm: null, septP3Epm: null });
}

describe("Float assessment fields", () => {
  it.each([["4.25", 4.25], ["4.0", 4], ["0", 0], ["-2.75", -2.75], [".125", 0.125], [" 123.4567 ", 123.4567], ["1e-7", 1e-7], [4.125, 4.125]])(
    "accepts %s as a number without integer or percentage restrictions", (input, expected) => {
      expect(validateAssessmentValue(input, field)).toEqual({ valid: true, value: expected, error: null });
    }
  );
  it.each([null, undefined, "", "  "])("keeps blank %s values null", (input) => {
    expect(validateAssessmentValue(input, field)).toEqual({ valid: true, value: null, error: null });
  });
  it.each(["PP", "4.2.1", "4.2abc", "0x10", "1,25", "NaN", "Infinity", "1e999", NaN, Infinity, -Infinity, true])(
    "rejects non-numeric or non-finite value %s", (input) => {
      expect(validateAssessmentValue(input, field).valid).toBe(false);
    }
  );
  it("respects explicit bounds and decimal precision, including scientific notation", () => {
    const restricted = { ...field, validationConfig: { min: -5, max: 10, precision: 2 } };
    expect(validateAssessmentValue("-4.25", restricted).valid).toBe(true);
    expect(validateAssessmentValue("10.01", restricted).valid).toBe(false);
    expect(validateAssessmentValue("-5.01", restricted).valid).toBe(false);
    expect(validateAssessmentValue("4.251", restricted).valid).toBe(false);
    expect(validateAssessmentValue(1e-7, restricted).valid).toBe(false);
    expect(validateAssessmentValue("1.25e1", { ...restricted, validationConfig: { precision: 1 } }).valid).toBe(true);
  });
  it("keeps decimal edits through the saved workspace format and in both tables, scoped to one year/window", () => {
    const row = updateAssessmentRowFromTableEdit(emptyRow(), assessment, fieldName, "4.125", context);
    const saved = parseWorkspaceState(JSON.parse(JSON.stringify({ rows: [row], templates: [assessment],
      placements: [{ studentId: row.id, ...context, homeroom: "4A" }], schoolYears: [context.schoolYear] })));
    const restored = hydrateOrfRow(saved.rows[0] as ReturnType<typeof emptyRow>);
    expect(saved.templates[0].fields[0].dataType).toBe("float");
    expect(buildEntryRows([restored], assessment, context)[0][fieldName]).toBe(4.125);
    expect(buildOverviewRows([restored], [assessment], context)[0][fieldName]).toBe(4.125);
    expect(buildEntryRows([restored], assessment, { ...context, schoolYear: "2026-2027" })[0][fieldName]).toBeNull();
    expect(buildEntryRows([restored], assessment, context)[0][assessmentValueKey(assessment, assessment.rounds[1], field)]).toBeNull();
    const cleared = updateAssessmentRowFromTableEdit(restored, assessment, fieldName, "", context);
    expect(buildEntryRows([cleared], assessment, context)[0][fieldName]).toBeNull();
  });
  it("preserves Float in year-specific definitions on reload", () => {
    const template = { ...assessment, yearDefinitions: { [context.schoolYear]: { ...assessment, fields: [field] } } };
    const restored = normalizeAssessmentTemplates(JSON.parse(JSON.stringify([template])))[0];
    expect(restored.fields[0].dataType).toBe("float");
    expect(restored.yearDefinitions?.[context.schoolYear].fields[0].dataType).toBe("float");
  });
  it.each(["4.25", -0.125, 0])("imports spreadsheet value %s as numeric data", (value) => {
    const result = applySpreadsheetAssessmentValues(emptyRow(), [{ value, match: { assessment, round, field, fieldName } }], context);
    expect(result.validationErrors).toEqual([]);
    expect(result.importedValueCount).toBe(1);
    expect(buildEntryRows([result.row], assessment, context)[0][fieldName]).toBe(Number(value));
  });
  it("preserves Float precision in charts without changing the other data types", () => {
    expect(averageDashboardValues([4.125], "float")).toBe(4.125);
    expect(averageDashboardValues([4.125, 4.375], "float")).toBe(4.25);
    expect(averageDashboardValues([0], "float")).toBe(0);
    expect(averageDashboardValues([-0.125], "float")).toBe(-0.125);
    expect(averageDashboardValues([], "float")).toBeNull();
    expect(averageDashboardValues([4.125], "percentage")).toBe(4.1);
  });
  it("retains decimals in student report tables and export layouts", () => {
    const row = updateAssessmentRowFromTableEdit(emptyRow(), assessment, fieldName, "4.125", context);
    const value = String(buildEntryRows([row], assessment, context)[0][fieldName]);
    const blocks = buildStudentReportBlocks([{ assessmentId: assessment.id, assessmentName: assessment.name, rows: [{
      studentId: row.id, student: row.student, year: context.schoolYear, grade: context.grade, homeroom: row.homeroom,
      assessmentId: assessment.id, assessment: assessment.name, roundId: round.id, window: round.label,
      windowColor: round.color ?? "", sectionId: "general", section: "General", fieldId: field.id, field: field.name, value
    }] }]);
    expect(Object.values(blocks[0].rows[0].values)).toContain("4.125");
    expect(buildStudentReportWorksheetLayout(blocks).rows.flat()).toContain("4.125");
  });
});
