import type {
  AssessmentFieldTemplate,
  AssessmentRoundTemplate,
  AssessmentSectionTemplate,
  AssessmentTemplate
} from "./assessment-templates";
import {
  assessmentValueKey,
  isCalculatedAssessmentField,
  isEditableAssessmentField,
  updateAssessmentRowFromTableEdit,
  validateAssessmentTableEdit,
  validateAssessmentValue
} from "./assessment-entry";
import type { OrfResultRow } from "./sample-results";

export type SpreadsheetImportValue = string | number | boolean | Date | null;

export type SpreadsheetAssessmentCell = {
  value: SpreadsheetImportValue;
  match: {
    assessment: AssessmentTemplate;
    round: AssessmentRoundTemplate;
    field: AssessmentFieldTemplate;
    section?: AssessmentSectionTemplate;
    fieldName: string;
  };
};

export type SpreadsheetAssessmentImportResult = {
  row: OrfResultRow;
  importedValueCount: number;
  skippedNonEditableValueCount: number;
  validationErrors: string[];
};

export function applySpreadsheetAssessmentValues(
  row: OrfResultRow,
  cells: SpreadsheetAssessmentCell[],
  context: { schoolYear: string; grade: string }
): SpreadsheetAssessmentImportResult {
  let nextRow = row;
  let importedValueCount = 0;
  let skippedNonEditableValueCount = 0;
  const validationErrors: string[] = [];

  const populatedCells = cells.filter(
    (cell) => cell.value !== "" && cell.value !== null && typeof cell.value !== "undefined"
  );
  const orderedCells = [
    ...populatedCells.filter((cell) => isEditableAssessmentField(cell.match.assessment, cell.match.field)),
    ...populatedCells.filter((cell) => isCalculatedAssessmentField(cell.match.field)),
    ...populatedCells.filter(
      (cell) => !isEditableAssessmentField(cell.match.assessment, cell.match.field) && !isCalculatedAssessmentField(cell.match.field)
    )
  ];

  orderedCells.forEach((cell) => {
    if (cell.match.field.dataType === "file") {
      skippedNonEditableValueCount += 1;
      return;
    }

    if (isCalculatedAssessmentField(cell.match.field)) {
      const validation = validateAssessmentValue(cell.value, cell.match.field);
      if (!validation.valid) {
        validationErrors.push(validation.error);
        return;
      }
      const storedKey = assessmentValueKey(
        cell.match.assessment,
        cell.match.round,
        cell.match.field,
        cell.match.section,
        context
      );
      nextRow = {
        ...nextRow,
        assessmentValues: {
          ...nextRow.assessmentValues,
          [storedKey]: validation.value
        }
      };
      importedValueCount += 1;
      return;
    }

    const validation = validateAssessmentTableEdit(
      nextRow,
      cell.match.assessment,
      cell.match.fieldName,
      cell.value,
      context
    );
    if (!validation.valid) {
      validationErrors.push(validation.error);
      return;
    }

    nextRow = updateAssessmentRowFromTableEdit(
      nextRow,
      cell.match.assessment,
      cell.match.fieldName,
      cell.value,
      context
    );
    importedValueCount += 1;
  });

  return {
    row: nextRow,
    importedValueCount,
    skippedNonEditableValueCount,
    validationErrors
  };
}
