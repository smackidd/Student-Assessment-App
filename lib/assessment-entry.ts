import {
  type AssessmentFieldTemplate,
  type AssessmentRoundTemplate,
  type AssessmentSectionTemplate,
  type AssessmentTemplate
} from "@/lib/assessment-templates";
import {
  calculateCwpm,
  calculateMedian,
  calculateOrfPercentile,
  resolveOrfPercentileCalculationKey
} from "@/lib/orf-calculations";
import {
  calculateCc3SupportFlag,
  calculateNumeracyWeightedScore,
  cc3NormFor,
  normalizeCc3Component,
  normalizeNumeracyComponent,
  numeracyNormFor,
  type Cc3Component,
  type NumeracyComponent
} from "@/lib/provincial-screening-norms";
import { hydrateOrfRow, type AssessmentValue, type AssessmentValueMap, type OrfResultRow } from "@/lib/sample-results";

export type EntryRow = OrfResultRow & Record<string, AssessmentValue | AssessmentValueMap | undefined>;
export type AssessmentValueContext = {
  schoolYear?: string;
  grade?: string;
  cohortRows?: OrfResultRow[];
};

export type AssessmentValueValidationResult =
  | { valid: true; value: AssessmentValue; error: null }
  | { valid: false; value: null; error: string };

export function buildEntryRows(rows: OrfResultRow[], selected: AssessmentTemplate[], context?: AssessmentValueContext): EntryRow[];
export function buildEntryRows(rows: OrfResultRow[], selected: AssessmentTemplate, context?: AssessmentValueContext): EntryRow[];
export function buildEntryRows(
  rows: OrfResultRow[],
  selected: AssessmentTemplate | AssessmentTemplate[],
  context: AssessmentValueContext = {}
): EntryRow[] {
  const templates = Array.isArray(selected) ? selected : [selected];
  return rows.map((row) => {
    const entry: EntryRow = { ...row };
    const rowContext = { ...context, cohortRows: context.cohortRows ?? rows };
    templates.forEach((template) => {
      template.rounds.forEach((round) => {
        assignFieldValues(entry, row, template, round, rowContext);
      });
    });
    return entry;
  });
}

export function buildOverviewRows(
  rows: OrfResultRow[],
  templates: AssessmentTemplate[],
  context: AssessmentValueContext = {}
): EntryRow[] {
  return buildEntryRows(rows, templates, context);
}

function assignFieldValues(
  entry: EntryRow,
  row: OrfResultRow,
  template: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  context: AssessmentValueContext
) {
  const sectionsForRound = sectionsForAssessmentRound(template, round, context.grade);
  template.fields
    .filter((field) =>
      assessmentFieldAppliesToGrade(field, context.grade) &&
      (!field.roundIds?.length || field.roundIds.includes(round.id))
    )
    .forEach((field) => {
      const fieldSections = sectionsForField(template, round, field, sectionsForRound);
      if (fieldSections.length) {
        fieldSections.forEach((section) => {
          entry[assessmentValueKey(template, round, field, section)] = entryValue(
            row,
            template,
            round,
            field,
            section,
            context
          );
        });
        return;
      }
      entry[assessmentValueKey(template, round, field)] = entryValue(row, template, round, field, undefined, context);
    });
}

export function entryValue(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  section?: AssessmentSectionTemplate,
  context: AssessmentValueContext = {}
) {
  const provincialValue = provincialNormEntryValue(row, assessment, round, field, section, context);
  if (typeof provincialValue !== "undefined") return provincialValue;
  if (isCalculatedAssessmentField(field) && hasScopedAssessmentContext(context)) {
    const importedOverride = storedAssessmentValue(row, assessment, round, field, section, context);
    if (typeof importedOverride !== "undefined") return importedOverride;
  }
  if (assessment.id === "orf" && field.isCalculated) {
    return orfEntryValue(row, assessment, round, field, section, context);
  }
  if (field.isCalculated && assessmentFieldMeaning(field) === "quick_write_percentile") {
    return quickWriteEntryValue(row, assessment, round, field, section, context);
  }
  if (field.isCalculated && assessmentFieldMeaning(field) === "percentage") {
    return percentageEntryValue(row, assessment, round, field, section, context);
  }

  const storedValue = storedAssessmentValue(row, assessment, round, field, section, context);
  if (typeof storedValue !== "undefined") return storedValue;

  if (assessment.id === "orf") {
    return orfEntryValue(row, assessment, round, field, section, context);
  }
  if (field.dataType === "file") return "";
  if (field.dataType === "letter") return "";
  if (field.dataType === "text") return "";
  if (field.dataType === "date") return "";
  return null;
}

function quickWriteEntryValue(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  section: AssessmentSectionTemplate | undefined,
  context: AssessmentValueContext
) {
  if (assessmentFieldMeaning(field) !== "quick_write_percentile") return null;
  const cwsField = assessment.fields.find((candidate) => assessmentFieldMeaning(candidate) === "cws");
  if (!cwsField) return null;

  const cws = storedAssessmentNumber(row, assessment, round, cwsField, section, null, context);
  if (typeof cws !== "number") return null;

  const cohortScores = (context.cohortRows ?? [])
    .map((cohortRow) => storedAssessmentNumber(cohortRow, assessment, round, cwsField, section, null, context))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return calculatePercentileRank(cws, cohortScores);
}

function calculatePercentileRank(score: number, cohortScores: number[]) {
  if (!cohortScores.length) return null;
  const below = cohortScores.filter((value) => value < score).length;
  const equal = cohortScores.filter((value) => value === score).length;
  return Math.round(((below + equal / 2) / cohortScores.length) * 100);
}

function percentageEntryValue(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  section: AssessmentSectionTemplate | undefined,
  context: AssessmentValueContext
) {
  if (assessmentFieldMeaning(field) !== "percentage") return null;
  const scoreField = matchingCalculationInputField(assessment, round, section, "score", field);
  const totalField = matchingCalculationInputField(assessment, round, section, "total", field);
  if (!scoreField || !totalField) return null;

  const score = storedAssessmentNumber(row, assessment, round, scoreField, section, null, context);
  const total = storedAssessmentNumber(row, assessment, round, totalField, section, null, context);
  if (typeof score !== "number" || typeof total !== "number" || total === 0) return null;

  return Math.round((score / total) * 1000) / 10;
}

function provincialNormEntryValue(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  section: AssessmentSectionTemplate | undefined,
  context: AssessmentValueContext
): AssessmentValue | undefined {
  const calculationKey = field.calculationKey;
  if (calculationKey === "cc3_component_total") {
    const norm = cc3NormFor(round.id, context.grade);
    const component = cc3ComponentForCell(field, section);
    return norm && component ? norm[component].max : null;
  }
  if (calculationKey === "cc3_requires_support") {
    const norm = cc3NormFor(round.id, context.grade);
    if (!norm) return null;
    const scores = cc3Scores(row, assessment, round, context);
    const requiresSupport = calculateCc3SupportFlag(norm, scores);
    return requiresSupport == null ? null : Number(requiresSupport);
  }
  if (calculationKey === "provincial_numeracy_component_total") {
    const norm = numeracyNormFor(round.id, context.grade);
    const component = numeracyComponentForCell(field, section);
    return norm?.components.find((item) => item.component === component)?.max ?? null;
  }
  if (
    calculationKey === "provincial_numeracy_weighted_score" ||
    calculationKey === "provincial_numeracy_requires_support"
  ) {
    const norm = numeracyNormFor(round.id, context.grade);
    if (!norm) return null;
    const weightedScore = calculateNumeracyWeightedScore(norm, numeracyScores(row, assessment, round, context));
    if (weightedScore == null) return null;
    return calculationKey === "provincial_numeracy_weighted_score"
      ? weightedScore
      : Number(weightedScore <= norm.weightedSupportMax);
  }
  return undefined;
}

function cc3Scores(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  context: AssessmentValueContext
) {
  const scores: Partial<Record<Cc3Component, number | null>> = {};
  for (const component of ["regular_words", "irregular_words", "non_words"] as const) {
    scores[component] = scoreForComponent(row, assessment, round, context, component, cc3ComponentForCell);
  }
  return scores;
}

function numeracyScores(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  context: AssessmentValueContext
) {
  const norm = numeracyNormFor(round.id, context.grade);
  const scores: Partial<Record<NumeracyComponent, number | null>> = {};
  norm?.components.forEach((item) => {
    scores[item.component] = scoreForComponent(
      row,
      assessment,
      round,
      context,
      item.component,
      numeracyComponentForCell
    );
  });
  return scores;
}

function scoreForComponent<TComponent extends string>(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  context: AssessmentValueContext,
  component: TComponent,
  componentForCell: (field: AssessmentFieldTemplate, section?: AssessmentSectionTemplate) => TComponent | null
) {
  const sections = sectionsForAssessmentRound(assessment, round, context.grade);
  for (const field of assessment.fields) {
    if (!assessmentFieldAppliesToGrade(field, context.grade) || assessmentFieldMeaning(field) !== "score") continue;
    if (field.roundIds?.length && !field.roundIds.includes(round.id)) continue;
    const fieldSections = sectionsForField(assessment, round, field, sections);
    if (!fieldSections.length && componentForCell(field) === component) {
      return storedAssessmentNumber(row, assessment, round, field, undefined, null, context);
    }
    const matchingSection = fieldSections.find((section) => componentForCell(field, section) === component);
    if (matchingSection) {
      return storedAssessmentNumber(row, assessment, round, field, matchingSection, null, context);
    }
  }
  return null;
}

function configuredComponent(field: AssessmentFieldTemplate) {
  const condition = field.calculationCondition;
  if (!condition || typeof condition !== "object" || !("component" in condition)) return undefined;
  const component = (condition as { component?: unknown }).component;
  return typeof component === "string" ? component : undefined;
}

function cc3ComponentForCell(field: AssessmentFieldTemplate, section?: AssessmentSectionTemplate) {
  return normalizeCc3Component(configuredComponent(field) ?? section?.name ?? field.groupLabel ?? field.name);
}

function numeracyComponentForCell(field: AssessmentFieldTemplate, section?: AssessmentSectionTemplate) {
  return normalizeNumeracyComponent(configuredComponent(field) ?? section?.name ?? field.groupLabel ?? field.name);
}

function matchingCalculationInputField(
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  section: AssessmentSectionTemplate | undefined,
  meaning: "score" | "total",
  calculatedField: AssessmentFieldTemplate
) {
  return matchingPairedField(assessment, round, section, meaning, calculatedField);
}

function matchingPairedField(
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  section: AssessmentSectionTemplate | undefined,
  meaning: "score" | "total",
  sourceField: AssessmentFieldTemplate
) {
  const sectionsForRound = sectionsForAssessmentRound(assessment, round);
  const candidates = assessment.fields.filter((field) => {
    if (field.id === sourceField.id || assessmentFieldMeaning(field) !== meaning) return false;
    if (field.roundIds?.length && !field.roundIds.includes(round.id)) return false;
    const fieldSections = sectionsForField(assessment, round, field, sectionsForRound);
    return section
      ? fieldSections.some((candidate) => candidate.id === section.id)
      : fieldSections.length === 0;
  });

  if (sourceField.groupLabel) {
    const grouped = candidates.filter((field) => field.groupLabel === sourceField.groupLabel);
    if (grouped.length === 1) return grouped[0];
  }

  const sourceGroupKey = calculationGroupKey(sourceField);
  if (sourceGroupKey) {
    const matchingGroup = candidates.filter((field) => calculationGroupKey(field) === sourceGroupKey);
    if (matchingGroup.length === 1) return matchingGroup[0];
  }

  return candidates.length === 1 ? candidates[0] : undefined;
}

function calculationGroupKey(field: AssessmentFieldTemplate) {
  if (field.groupLabel) return slugForAssessmentKey(field.groupLabel);
  const candidate = [field.slug, field.id, field.name]
    .map(slugForAssessmentKey)
    .find((value) => /_(score|total|percentage|percent|pct)$/.test(value));
  return candidate?.replace(/_(score|total|percentage|percent|pct)$/, "") || undefined;
}

export function isEditableAssessmentField(_assessment: AssessmentTemplate, field: AssessmentFieldTemplate) {
  if (field.dataType === "file" || field.dataType === "calculated") return false;
  return !field.isCalculated;
}

export function isCalculatedAssessmentField(field: AssessmentFieldTemplate) {
  return field.isCalculated || field.dataType === "calculated";
}

function orfEntryValue(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  section?: AssessmentSectionTemplate,
  context: AssessmentValueContext = {}
) {
  const calculatedRound = calculateOrfWindow(row, assessment, round, context);
  const sectionIndex = orfPassageIndex(assessment, round, section);
  const sectionValue = calculatedRound.passages[sectionIndex] ?? calculatedRound.passages[0];
  const meaning = assessmentFieldMeaning(field);

  if (meaning === "wpm") return sectionValue.wpm;
  if (meaning === "epm") return sectionValue.epm;
  if (meaning === "cwpm") return sectionValue.cwpm;
  if (meaning === "median") return calculatedRound.median;
  if (meaning === "percentile") return calculatedRound.percentile;
  return null;
}

export function calculateOrfWindow(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  context: AssessmentValueContext = {}
) {
  const sections = sectionsForAssessmentRound(assessment, round);
  const wpmField = assessment.fields.find((field) => assessmentFieldMeaning(field) === "wpm");
  const epmField = assessment.fields.find((field) => assessmentFieldMeaning(field) === "epm");
  const cwpmField = assessment.fields.find((field) => assessmentFieldMeaning(field) === "cwpm");
  const percentileField = assessment.fields.find(
    (field) =>
      assessmentFieldMeaning(field) === "percentile" &&
      (!field.roundIds?.length || field.roundIds.includes(round.id))
  );
  const useLegacyFallback = !hasScopedAssessmentContext(context);

  const passages = [0, 1, 2].map((index) => {
    const section = sections[index];
    const wpm = wpmField
      ? storedAssessmentNumber(
          row,
          assessment,
          round,
          wpmField,
          section,
          useLegacyFallback ? legacyOrfFallback(row, round, index, "wpm") : null,
          context
        )
      : null;
    const epm = epmField
      ? storedAssessmentNumber(
          row,
          assessment,
          round,
          epmField,
          section,
          useLegacyFallback ? legacyOrfFallback(row, round, index, "epm") : null,
          context
        )
      : null;
    const storedCwpm = cwpmField && !cwpmField.isCalculated
      ? storedAssessmentNumber(
          row,
          assessment,
          round,
          cwpmField,
          section,
          useLegacyFallback ? legacyOrfFallback(row, round, index, "cwpm") : null,
          context
        )
      : null;
    const cwpm = typeof storedCwpm === "number" ? storedCwpm : calculateCwpm(wpm, epm);

    return {
      wpm,
      epm,
      cwpm
    };
  });
  const median = calculateMedian(passages.map((passage) => passage.cwpm));
  const hasThreePassages = passages.every((passage) => typeof passage.cwpm === "number");
  const percentileCalculationKey = resolveOrfPercentileCalculationKey(percentileField?.calculationKey, round.id);

  return {
    passages,
    median,
    percentile: hasThreePassages
      ? calculateOrfPercentile(median, context.grade, percentileCalculationKey)
      : null
  };
}

function orfPassageIndex(assessment: AssessmentTemplate, round: AssessmentRoundTemplate, section?: AssessmentSectionTemplate) {
  if (!section) return 0;
  const sectionIndex = sectionsForAssessmentRound(assessment, round).findIndex((candidate) => candidate.id === section.id);
  return sectionIndex >= 0 ? sectionIndex : 0;
}

export function validateAssessmentValue(
  value: unknown,
  field: AssessmentFieldTemplate
): AssessmentValueValidationResult {
  if (value === null || typeof value === "undefined" || (typeof value === "string" && value.trim() === "")) {
    return { valid: true, value: null, error: null };
  }

  if (field.dataType !== "integer" && field.dataType !== "percentage" && field.dataType !== "calculated") {
    return { valid: true, value: String(value), error: null };
  }

  const rawValue = typeof value === "string" ? value.trim() : value;
  const numericPattern = field.dataType === "integer"
    ? /^[+-]?\d+$/
    : /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

  if (typeof rawValue !== "number" && (typeof rawValue !== "string" || !numericPattern.test(rawValue))) {
    return {
      valid: false,
      value: null,
      error: field.dataType === "integer"
        ? `${field.name} must be a whole number.`
        : `${field.name} must be a number.`
    };
  }

  const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isFinite(numericValue)) {
    return { valid: false, value: null, error: `${field.name} must be a finite number.` };
  }
  if (field.dataType === "integer" && !Number.isSafeInteger(numericValue)) {
    return { valid: false, value: null, error: `${field.name} must be a whole number.` };
  }

  const minimum = field.validationConfig?.min ?? 0;
  const maximum = field.validationConfig?.max ?? (field.dataType === "percentage" ? 100 : Number.MAX_SAFE_INTEGER);
  if (numericValue < minimum || numericValue > maximum) {
    return {
      valid: false,
      value: null,
      error: `${field.name} must be between ${minimum} and ${maximum}.`
    };
  }

  const precision = field.validationConfig?.precision;
  if (typeof precision === "number" && decimalPlaces(rawValue) > precision) {
    return {
      valid: false,
      value: null,
      error: `${field.name} can have at most ${precision} decimal place${precision === 1 ? "" : "s"}.`
    };
  }

  return { valid: true, value: numericValue, error: null };
}

function decimalPlaces(value: string | number) {
  const [, fraction = ""] = String(value).split(".");
  return fraction.length;
}

export function validateAssessmentTableEdit(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  fieldName: string,
  newValue: unknown,
  context: AssessmentValueContext = {}
): AssessmentValueValidationResult {
  const cell = findAssessmentCell(assessment, fieldName, context);
  if (!cell) return { valid: false, value: null, error: "This assessment field is no longer available." };
  if (!isEditableAssessmentField(assessment, cell.field)) {
    return { valid: false, value: null, error: `${cell.field.name} cannot be edited.` };
  }

  const validation = validateAssessmentValue(newValue, cell.field);
  if (!validation.valid || typeof validation.value !== "number") return validation;

  const meaning = assessmentFieldMeaning(cell.field);
  if (meaning !== "score" && meaning !== "total") return validation;

  const counterpartMeaning = meaning === "score" ? "total" : "score";
  const counterpart = matchingPairedField(
    assessment,
    cell.round,
    cell.section,
    counterpartMeaning,
    cell.field
  );
  if (!counterpart) return validation;

  const counterpartValue = entryValue(row, assessment, cell.round, counterpart, cell.section, context);
  const counterpartNumber = toNumber(counterpartValue);
  if (typeof counterpartNumber !== "number") return validation;

  const score = meaning === "score" ? validation.value : counterpartNumber;
  const total = meaning === "total" ? validation.value : counterpartNumber;
  if (score > total) {
    return {
      valid: false,
      value: null,
      error: `${cell.field.name} is invalid because Score (${score}) cannot exceed Total (${total}).`
    };
  }

  return validation;
}

export function updateAssessmentRowFromTableEdit(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  fieldName: string,
  newValue: unknown,
  context: AssessmentValueContext = {}
) {
  const cell = findAssessmentCell(assessment, fieldName, context);
  if (!cell) return row;

  const validation = validateAssessmentTableEdit(row, assessment, fieldName, newValue, context);
  if (!validation.valid) return row;
  const value = validation.value;
  const storedKey = assessmentValueKey(assessment, cell.round, cell.field, cell.section, context);
  const assessmentValues = withoutCalculatedOverrides(row.assessmentValues, assessment, cell.round, context);
  const nextRow: OrfResultRow = {
    ...row,
    assessmentValues: {
      ...assessmentValues,
      [storedKey]: value
    }
  };

  if (assessment.id !== "orf") return nextRow;

  const passageIndex = orfPassageIndex(assessment, cell.round, cell.section);
  const meaning = assessmentFieldMeaning(cell.field);
  if (meaning !== "wpm" && meaning !== "epm") return nextRow;

  const patch = {
    id: row.id,
    homeroom: row.homeroom,
    student: row.student,
    assessmentValues: nextRow.assessmentValues,
    septP1Wpm: row.septP1Wpm,
    septP1Epm: row.septP1Epm,
    septP2Wpm: row.septP2Wpm,
    septP2Epm: row.septP2Epm,
    septP3Wpm: row.septP3Wpm,
    septP3Epm: row.septP3Epm
  };

  if (cell.round.id === "fall" && passageIndex === 0 && meaning === "wpm") patch.septP1Wpm = toNumber(value);
  if (cell.round.id === "fall" && passageIndex === 0 && meaning === "epm") patch.septP1Epm = toNumber(value);
  if (cell.round.id === "fall" && passageIndex === 1 && meaning === "wpm") patch.septP2Wpm = toNumber(value);
  if (cell.round.id === "fall" && passageIndex === 1 && meaning === "epm") patch.septP2Epm = toNumber(value);
  if (cell.round.id === "fall" && passageIndex === 2 && meaning === "wpm") patch.septP3Wpm = toNumber(value);
  if (cell.round.id === "fall" && passageIndex === 2 && meaning === "epm") patch.septP3Epm = toNumber(value);

  return hydrateOrfRow(patch);
}

function withoutCalculatedOverrides(
  values: OrfResultRow["assessmentValues"],
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  context: AssessmentValueContext
) {
  const nextValues = { ...values };
  const sectionsForRound = sectionsForAssessmentRound(assessment, round, context.grade);

  assessment.fields
    .filter((field) => isCalculatedAssessmentField(field) && (!field.roundIds?.length || field.roundIds.includes(round.id)))
    .forEach((field) => {
      const fieldSections = sectionsForField(assessment, round, field, sectionsForRound);
      if (fieldSections.length) {
        fieldSections.forEach((section) => {
          assessmentValueKeys(assessment, round, field, section, context).forEach((key) => delete nextValues[key]);
        });
        return;
      }
      assessmentValueKeys(assessment, round, field, undefined, context).forEach((key) => delete nextValues[key]);
    });

  return nextValues;
}

function storedAssessmentNumber(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  section: AssessmentSectionTemplate | undefined,
  fallback: number | null,
  context: AssessmentValueContext
) {
  const storedValue = storedAssessmentValue(row, assessment, round, field, section, context);
  if (typeof storedValue !== "undefined") return toNumber(storedValue);
  return fallback;
}

function legacyOrfFallback(row: OrfResultRow, round: AssessmentRoundTemplate, passageIndex: number, fieldType: "wpm" | "epm" | "cwpm") {
  const legacyStoredValue = row.assessmentValues?.[`${round.id}_passage_${passageIndex + 1}_${fieldType}`];
  if (typeof legacyStoredValue !== "undefined") return toNumber(legacyStoredValue);
  if (round.id !== "fall") return null;
  if (passageIndex === 0 && fieldType === "wpm") return row.septP1Wpm;
  if (passageIndex === 0 && fieldType === "epm") return row.septP1Epm;
  if (passageIndex === 0 && fieldType === "cwpm") return row.septP1Cwpm;
  if (passageIndex === 1 && fieldType === "wpm") return row.septP2Wpm;
  if (passageIndex === 1 && fieldType === "epm") return row.septP2Epm;
  if (passageIndex === 1 && fieldType === "cwpm") return row.septP2Cwpm;
  if (passageIndex === 2 && fieldType === "wpm") return row.septP3Wpm;
  if (passageIndex === 2 && fieldType === "epm") return row.septP3Epm;
  if (passageIndex === 2 && fieldType === "cwpm") return row.septP3Cwpm;
  return null;
}

function findAssessmentCell(
  assessment: AssessmentTemplate,
  fieldName: string,
  context: AssessmentValueContext = {}
) {
  for (const round of assessment.rounds) {
    const fieldsForRound = assessment.fields.filter((field) =>
      assessmentFieldAppliesToGrade(field, context.grade) &&
      (!field.roundIds?.length || field.roundIds.includes(round.id))
    );
    const sectionsForRound = sectionsForAssessmentRound(assessment, round, context.grade);
    for (const field of fieldsForRound) {
      const fieldSections = sectionsForField(assessment, round, field, sectionsForRound);
      if (!fieldSections.length && assessmentValueKeys(assessment, round, field).includes(fieldName)) {
        return { round, field };
      }
      const section = fieldSections.find((candidate) => assessmentValueKeys(assessment, round, field, candidate).includes(fieldName));
      if (section) return { round, field, section };
    }
  }
  return null;
}

function sectionsForField(
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  sectionsForRound = sectionsForAssessmentRound(assessment, round)
) {
  if (!field.sectionIds?.length) return [];
  const exactSections = sectionsForRound.filter((section) => field.sectionIds?.includes(section.id));
  if (exactSections.length || assessment.id !== "orf") return exactSections;
  return sectionsForRound;
}

export function assessmentValueKey(
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  section?: AssessmentSectionTemplate,
  context: AssessmentValueContext = {}
) {
  return assessmentValueKeys(assessment, round, field, section, context)[0];
}

export function assessmentValueKeys(
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  section?: AssessmentSectionTemplate,
  context: AssessmentValueContext = {}
) {
  const baseKeys = [
    [
      labelWithId(assessment.name, assessment.id),
      labelWithId(round.label, round.id),
      section ? labelWithId(section.name, section.id) : undefined,
      labelWithId(field.name, field.id)
    ]
      .filter((value): value is string => Boolean(value))
      .map(slugForAssessmentKey)
      .join("__"),
    [
      assessment.name,
      round.label,
      section?.name,
      field.name
    ]
      .filter((value): value is string => Boolean(value))
      .map(slugForAssessmentKey)
      .join("__")
  ];
  const scopedPrefix = assessmentContextPrefix(context);
  return uniqueIds(scopedPrefix ? baseKeys.map((key) => `${scopedPrefix}__${key}`) : baseKeys);
}

function storedAssessmentValue(
  row: OrfResultRow,
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  field: AssessmentFieldTemplate,
  section?: AssessmentSectionTemplate,
  context: AssessmentValueContext = {}
) {
  return assessmentValueKeys(assessment, round, field, section, context)
    .map((key) => row.assessmentValues?.[key])
    .find((value) => typeof value !== "undefined");
}

function assessmentContextPrefix(context: AssessmentValueContext) {
  const parts = [
    context.schoolYear ? `year_${context.schoolYear}` : undefined,
    context.grade ? `grade_${context.grade}` : undefined
  ].filter((value): value is string => Boolean(value));
  return parts.length ? parts.map(slugForAssessmentKey).join("__") : "";
}

function hasScopedAssessmentContext(context: AssessmentValueContext) {
  return Boolean(context.schoolYear || context.grade);
}

function labelWithId(label: string, id: string) {
  return `${label} ${id}`;
}

function slugForAssessmentKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "untitled";
}

export function normalizedAssessmentValue(value: unknown, field: AssessmentFieldTemplate): AssessmentValue {
  const validation = validateAssessmentValue(value, field);
  return validation.valid ? validation.value : null;
}

function assessmentFieldMeaning(field: AssessmentFieldTemplate) {
  const candidates = [field.calculationKey, field.slug, field.id, field.name]
    .filter((value): value is string => Boolean(value))
    .map(slugForAssessmentKey);

  if (candidates.some((value) => value === "orf_cwpm" || value === "cwpm")) return "cwpm";
  if (candidates.some((value) => value === "median" || value === "med" || value === "orf_med")) return "median";
  if (candidates.some((value) => value === "quick_write_percentile" || value === "quick_write_ile")) return "quick_write_percentile";
  if (candidates.some((value) => value === "percentage" || value === "percent" || value === "pct")) return "percentage";
  if (candidates.some((value) =>
    value === "orf_percentile" ||
    value.startsWith("orf_percentile_fastbridge2019_") ||
    value === "percentile" ||
    value === "ile"
  )) return "percentile";
  if (candidates.some((value) => value === "wpm")) return "wpm";
  if (candidates.some((value) => value === "epm")) return "epm";
  if (candidates.some((value) => value === "tww")) return "tww";
  if (candidates.some((value) => value === "wsc")) return "wsc";
  if (candidates.some((value) => value === "cws")) return "cws";
  if (candidates.some((value) => value === "score" || value.endsWith("_score"))) return "score";
  if (candidates.some((value) => value === "total" || value.endsWith("_total"))) return "total";
  return field.id || field.slug;
}

export function assessmentFieldAppliesToGrade(field: AssessmentFieldTemplate, grade?: string | null) {
  return !field.gradeIds?.length || !grade || field.gradeIds.includes(grade);
}

export function assessmentSectionAppliesToGrade(section: AssessmentSectionTemplate, grade?: string | null) {
  return !section.gradeIds?.length || !grade || section.gradeIds.includes(grade);
}

export function sectionsForAssessmentRound(
  assessment: AssessmentTemplate,
  round: AssessmentRoundTemplate,
  grade?: string | null
) {
  const matchingSections = (assessment.sections ?? []).filter((section) =>
    section.roundIds.includes(round.id) && assessmentSectionAppliesToGrade(section, grade)
  );
  if (matchingSections.length || assessment.id !== "orf") return matchingSections;
  return [
    { id: "passage-1", name: "1st passage", roundIds: [round.id] },
    { id: "passage-2", name: "2nd passage", roundIds: [round.id] },
    { id: "passage-3", name: "3rd passage", roundIds: [round.id] }
  ];
}

export function labelsForIds(items: Array<{ id: string; label?: string; name?: string }>, ids: string[]) {
  return ids
    .map((id) => {
      const item = items.find((candidate) => candidate.id === id);
      return item?.label ?? item?.name ?? id;
    })
    .join(", ");
}

export function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids));
}

export function fieldWindowSummary(template: AssessmentTemplate, field: AssessmentFieldTemplate) {
  return field.roundIds?.length ? labelsForIds(template.rounds, field.roundIds) : "All windows";
}

export function fieldSectionSummary(template: AssessmentTemplate, field: AssessmentFieldTemplate) {
  return field.sectionIds?.length ? labelsForIds(template.sections ?? [], field.sectionIds) : "No sections";
}

export function toNumber(value: unknown) {
  if (value === null || typeof value === "undefined") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmedValue = value.trim();
  if (!trimmedValue || !/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmedValue)) return null;
  const numberValue = Number(trimmedValue);
  return Number.isFinite(numberValue) ? numberValue : null;
}
