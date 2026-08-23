import { describe, expect, it } from "vitest";
import { assessmentTemplates, type AssessmentTemplate } from "./assessment-templates";
import {
  assessmentValueKey,
  buildEntryRows,
  sectionsForAssessmentRound,
  updateAssessmentRowFromTableEdit
} from "./assessment-entry";
import { hydrateOrfRow } from "./sample-results";
import { applySpreadsheetAssessmentValues, type SpreadsheetAssessmentCell } from "./spreadsheet-import";

function emptyRow() {
  return hydrateOrfRow({
    id: "student-import-test",
    homeroom: "4A",
    student: "Import Student",
    septP1Wpm: null,
    septP1Epm: null,
    septP2Wpm: null,
    septP2Epm: null,
    septP3Wpm: null,
    septP3Epm: null
  });
}

describe("spreadsheet assessment imports", () => {
  it("imports ORF source values and treats workbook formula results as authoritative", () => {
    const assessment = assessmentTemplates.find((template) => template.id === "orf") as AssessmentTemplate;
    const round = assessment.rounds[0];
    const section = sectionsForAssessmentRound(assessment, round)[0];
    const wpm = assessment.fields.find((field) => field.id === "wpm")!;
    const epm = assessment.fields.find((field) => field.id === "epm")!;
    const cwpm = assessment.fields.find((field) => field.id === "cwpm")!;
    const median = assessment.fields.find((field) => field.id === "median")!;
    const percentile = assessment.fields.find((field) => field.roundIds?.includes(round.id) && field.name === "%ile")!;
    const cells: SpreadsheetAssessmentCell[] = [
      { value: 52, match: { assessment, round, field: wpm, section, fieldName: assessmentValueKey(assessment, round, wpm, section) } },
      { value: 7, match: { assessment, round, field: epm, section, fieldName: assessmentValueKey(assessment, round, epm, section) } },
      { value: 46, match: { assessment, round, field: cwpm, section, fieldName: assessmentValueKey(assessment, round, cwpm, section) } },
      { value: 44, match: { assessment, round, field: median, fieldName: assessmentValueKey(assessment, round, median) } },
      { value: 12, match: { assessment, round, field: percentile, fieldName: assessmentValueKey(assessment, round, percentile) } }
    ];

    const result = applySpreadsheetAssessmentValues(emptyRow(), cells, { schoolYear: "2023-2024", grade: "4" });
    const entry = buildEntryRows([result.row], assessment, { schoolYear: "2023-2024", grade: "4" })[0];

    expect(result.validationErrors).toEqual([]);
    expect(result.importedValueCount).toBe(5);
    expect(result.skippedNonEditableValueCount).toBe(0);
    expect(entry[assessmentValueKey(assessment, round, wpm, section)]).toBe(52);
    expect(entry[assessmentValueKey(assessment, round, epm, section)]).toBe(7);
    expect(entry[assessmentValueKey(assessment, round, cwpm, section)]).toBe(46);
    expect(entry[assessmentValueKey(assessment, round, median)]).toBe(44);
    expect(entry[assessmentValueKey(assessment, round, percentile)]).toBe(12);

    const editedRow = updateAssessmentRowFromTableEdit(
      result.row,
      assessment,
      assessmentValueKey(assessment, round, wpm, section),
      60,
      { schoolYear: "2023-2024", grade: "4" }
    );
    const editedEntry = buildEntryRows([editedRow], assessment, { schoolYear: "2023-2024", grade: "4" })[0];
    expect(editedEntry[assessmentValueKey(assessment, round, cwpm, section)]).toBe(53);
    expect(editedEntry[assessmentValueKey(assessment, round, median)]).toBe(53);
  });

  it("skips spreadsheet file-name values instead of aborting the import", () => {
    const assessment: AssessmentTemplate = {
      id: "report-import-test",
      name: "Report Import Test",
      category: "Reports",
      description: "Import test",
      gradeScope: "Grade 4",
      rounds: [{ id: "fall", label: "Fall", month: "September" }],
      fields: [
        {
          id: "report-file",
          name: "Report",
          slug: "report",
          dataType: "file",
          isRequired: false,
          isCalculated: false,
          visibility: "evaluators"
        }
      ]
    };
    const field = assessment.fields[0];
    const fieldName = assessmentValueKey(assessment, assessment.rounds[0], field);

    const result = applySpreadsheetAssessmentValues(
      emptyRow(),
      [{ value: "student-report.pdf", match: { assessment, round: assessment.rounds[0], field, fieldName } }],
      { schoolYear: "2023-2024", grade: "4" }
    );

    expect(result.validationErrors).toEqual([]);
    expect(result.importedValueCount).toBe(0);
    expect(result.skippedNonEditableValueCount).toBe(1);
    expect(result.row.assessmentValues?.[fieldName]).toBeUndefined();
  });

  it("uses an imported percentage instead of the live Score divided by Total calculation", () => {
    const assessment: AssessmentTemplate = {
      id: "percentage-import-test",
      name: "Percentage Import Test",
      category: "Custom",
      description: "Import test",
      gradeScope: "Grade 4",
      rounds: [{ id: "fall", label: "Fall", month: "September" }],
      sections: [{ id: "domain-a", name: "Domain A", roundIds: ["fall"] }],
      fields: [
        { id: "score", name: "Score", slug: "score", dataType: "integer", sectionIds: ["domain-a"], isRequired: false, isCalculated: false, visibility: "evaluators" },
        { id: "total", name: "Total", slug: "total", dataType: "integer", sectionIds: ["domain-a"], isRequired: false, isCalculated: false, visibility: "evaluators" },
        { id: "percentage", name: "%", slug: "percentage", dataType: "calculated", sectionIds: ["domain-a"], isRequired: false, isCalculated: true, calculationKey: "percentage", visibility: "evaluators" }
      ]
    };
    const round = assessment.rounds[0];
    const section = assessment.sections![0];
    const [score, total, percentage] = assessment.fields;
    const cells: SpreadsheetAssessmentCell[] = [
      { value: 18, match: { assessment, round, section, field: score, fieldName: assessmentValueKey(assessment, round, score, section) } },
      { value: 24, match: { assessment, round, section, field: total, fieldName: assessmentValueKey(assessment, round, total, section) } },
      { value: 80, match: { assessment, round, section, field: percentage, fieldName: assessmentValueKey(assessment, round, percentage, section) } }
    ];
    const context = { schoolYear: "2023-2024", grade: "4" };

    const result = applySpreadsheetAssessmentValues(emptyRow(), cells, context);
    const importedEntry = buildEntryRows([result.row], assessment, context)[0];
    expect(importedEntry[assessmentValueKey(assessment, round, percentage, section)]).toBe(80);

    const editedRow = updateAssessmentRowFromTableEdit(
      result.row,
      assessment,
      assessmentValueKey(assessment, round, score, section),
      20,
      context
    );
    const editedEntry = buildEntryRows([editedRow], assessment, context)[0];
    expect(editedEntry[assessmentValueKey(assessment, round, percentage, section)]).toBe(83.3);
  });
});
