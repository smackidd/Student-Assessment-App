import { describe, expect, it } from "vitest";
import { assessmentTemplates, type AssessmentTemplate } from "./assessment-templates";
import {
  assessmentValueKey,
  buildEntryRows,
  isEditableAssessmentField,
  sectionsForAssessmentRound,
  updateAssessmentRowFromTableEdit,
  validateAssessmentTableEdit,
  validateAssessmentValue
} from "./assessment-entry";
import { hydrateOrfRow, type OrfResultRow } from "./sample-results";

function emptyRow(): OrfResultRow {
  return hydrateOrfRow({
    id: "student-test",
    homeroom: "3A",
    student: "Test Student",
    septP1Wpm: null,
    septP1Epm: null,
    septP2Wpm: null,
    septP2Epm: null,
    septP3Wpm: null,
    septP3Epm: null
  });
}

function customOrfTemplate() {
  const template = assessmentTemplates.find((assessment) => assessment.id === "orf") as AssessmentTemplate;
  return {
    ...template,
    sections: [
      { id: "section_1781805219085", name: "1st Passage", roundIds: ["fall", "winter", "spring"] },
      { id: "section_1781805232265", name: "2nd Passage", roundIds: ["fall", "winter", "spring"] },
      { id: "section_1781805242651", name: "3rd Passage", roundIds: ["fall", "winter", "spring"] }
    ],
    fields: template.fields.map((field) => {
      if (field.id === "cwpm") return { ...field, id: "orf_cwpm_5", calculationKey: "orf_cwpm" };
      if (field.id === "median") return { ...field, id: "orf_med_4", name: "MED", calculationKey: "median" };
      if (field.id === "percentile") return { ...field, id: "orf_ile_5", name: "%ile", calculationKey: "orf_percentile" };
      return field;
    })
  };
}

describe("assessment entry rows", () => {
  it("uses distinct keys for each ORF passage field", () => {
    const orf = customOrfTemplate();
    const fall = orf.rounds[0];
    const sections = sectionsForAssessmentRound(orf, fall);
    const wpm = orf.fields.find((field) => field.id === "wpm");

    expect(wpm).toBeDefined();
    const keys = sections.map((section) => assessmentValueKey(orf, fall, wpm!, section));

    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toContain("1st_passage");
    expect(keys[1]).toContain("2nd_passage");
    expect(keys[2]).toContain("3rd_passage");
  });

  it("does not copy a 1st passage WPM/EPM edit into other passages and suppresses unapproved percentiles", () => {
    const orf = customOrfTemplate();
    const fall = orf.rounds[0];
    const sections = sectionsForAssessmentRound(orf, fall);
    const wpm = orf.fields.find((field) => field.id === "wpm")!;
    const epm = orf.fields.find((field) => field.id === "epm")!;
    const cwpm = orf.fields.find((field) => field.id === "orf_cwpm_5")!;
    const median = orf.fields.find((field) => field.id === "orf_med_4")!;
    const percentile = orf.fields.find((field) => field.id === "orf_ile_5")!;

    const firstWpmKey = assessmentValueKey(orf, fall, wpm, sections[0]);
    const firstEpmKey = assessmentValueKey(orf, fall, epm, sections[0]);
    const secondWpmKey = assessmentValueKey(orf, fall, wpm, sections[1]);
    const thirdWpmKey = assessmentValueKey(orf, fall, wpm, sections[2]);
    const firstCwpmKey = assessmentValueKey(orf, fall, cwpm, sections[0]);
    const secondCwpmKey = assessmentValueKey(orf, fall, cwpm, sections[1]);
    const thirdCwpmKey = assessmentValueKey(orf, fall, cwpm, sections[2]);
    const medianKey = assessmentValueKey(orf, fall, median);
    const percentileKey = assessmentValueKey(orf, fall, percentile);

    let row = updateAssessmentRowFromTableEdit(emptyRow(), orf, firstWpmKey, 47);
    row = updateAssessmentRowFromTableEdit(row, orf, firstEpmKey, 7);
    const entry = buildEntryRows([row], orf)[0];

    expect(entry[firstWpmKey]).toBe(47);
    expect(entry[firstEpmKey]).toBe(7);
    expect(entry[firstCwpmKey]).toBe(40);
    expect(entry[secondWpmKey]).toBeNull();
    expect(entry[thirdWpmKey]).toBeNull();
    expect(entry[secondCwpmKey]).toBeNull();
    expect(entry[thirdCwpmKey]).toBeNull();
    expect(entry[medianKey]).toBe(40);
    expect(entry[percentileKey]).toBeNull();
  });

  it("recalculates MED while suppressing percentiles and keeping CWPM locked", () => {
    const orf = customOrfTemplate();
    const fall = orf.rounds[0];
    const sections = sectionsForAssessmentRound(orf, fall);
    const wpm = orf.fields.find((field) => field.id === "wpm")!;
    const epm = orf.fields.find((field) => field.id === "epm")!;
    const cwpm = orf.fields.find((field) => field.id === "orf_cwpm_5")!;
    const median = orf.fields.find((field) => field.id === "orf_med_4")!;
    const percentile = orf.fields.find((field) => field.id === "orf_ile_5")!;

    let row = emptyRow();
    for (const [index, value] of [42, 24, 15].entries()) {
      row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, wpm, sections[index]), value);
      row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, epm, sections[index]), 0);
    }
    const beforeCalculatedEdit = row;
    row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, cwpm, sections[0]), 999);
    const entry = buildEntryRows([row], orf)[0];

    expect(row).toBe(beforeCalculatedEdit);
    expect(isEditableAssessmentField(orf, cwpm)).toBe(false);
    expect(entry[assessmentValueKey(orf, fall, cwpm, sections[0])]).toBe(42);
    expect(entry[assessmentValueKey(orf, fall, median)]).toBe(24);
    expect(entry[assessmentValueKey(orf, fall, percentile)]).toBeNull();
  });

  it("does not let a legacy stored CWPM override the calculated WPM minus EPM value", () => {
    const orf = customOrfTemplate();
    const fall = orf.rounds[0];
    const section = sectionsForAssessmentRound(orf, fall)[0];
    const wpm = orf.fields.find((field) => field.id === "wpm")!;
    const epm = orf.fields.find((field) => field.id === "epm")!;
    const cwpm = orf.fields.find((field) => field.id === "orf_cwpm_5")!;
    const cwpmKey = assessmentValueKey(orf, fall, cwpm, section);

    let row = updateAssessmentRowFromTableEdit(emptyRow(), orf, assessmentValueKey(orf, fall, wpm, section), 52);
    row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, epm, section), 7);
    const rowWithLegacyCwpm = {
      ...row,
      assessmentValues: { ...row.assessmentValues, [cwpmKey]: 999 }
    };

    expect(buildEntryRows([rowWithLegacyCwpm], orf)[0][cwpmKey]).toBe(45);
  });

  it("keeps the same student's ORF values separate by school year and grade", () => {
    const orf = customOrfTemplate();
    const fall = orf.rounds[0];
    const sections = sectionsForAssessmentRound(orf, fall);
    const wpm = orf.fields.find((field) => field.id === "wpm")!;
    const epm = orf.fields.find((field) => field.id === "epm")!;
    const median = orf.fields.find((field) => field.id === "orf_med_4")!;

    let row = emptyRow();
    for (const [context, value] of [
      [{ schoolYear: "2024-2025", grade: "3" }, 67],
      [{ schoolYear: "2025-2026", grade: "4" }, 73],
      [{ schoolYear: "2026-2027", grade: "5" }, 75]
    ] as const) {
      row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, wpm, sections[0]), value, context);
      row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, epm, sections[0]), 0, context);
    }

    expect(buildEntryRows([row], orf, { schoolYear: "2024-2025", grade: "3" })[0][assessmentValueKey(orf, fall, median)]).toBe(67);
    expect(buildEntryRows([row], orf, { schoolYear: "2025-2026", grade: "4" })[0][assessmentValueKey(orf, fall, median)]).toBe(73);
    expect(buildEntryRows([row], orf, { schoolYear: "2026-2027", grade: "5" })[0][assessmentValueKey(orf, fall, median)]).toBe(75);
  });

  it("does not show prior unscoped ORF values when a student is viewed in a new school year", () => {
    const orf = customOrfTemplate();
    const fall = orf.rounds[0];
    const sections = sectionsForAssessmentRound(orf, fall);
    const wpm = orf.fields.find((field) => field.id === "wpm")!;
    const epm = orf.fields.find((field) => field.id === "epm")!;
    const median = orf.fields.find((field) => field.id === "orf_med_4")!;

    let row = emptyRow();
    row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, wpm, sections[0]), 81);
    row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, epm, sections[0]), 6);

    const newYearEntry = buildEntryRows([row], orf, { schoolYear: "2026-2027", grade: "4" })[0];

    expect(newYearEntry[assessmentValueKey(orf, fall, wpm, sections[0])]).toBeNull();
    expect(newYearEntry[assessmentValueKey(orf, fall, epm, sections[0])]).toBeNull();
    expect(newYearEntry[assessmentValueKey(orf, fall, median)]).toBeNull();
  });

  it("does not show prior unscoped non-ORF values when a student is viewed in a new school year", () => {
    const quickWrite = assessmentTemplates.find((assessment) => assessment.id === "quick-write") as AssessmentTemplate;
    const fall = quickWrite.rounds[0];
    const tww = quickWrite.fields.find((field) => field.id === "tww")!;

    const row = updateAssessmentRowFromTableEdit(emptyRow(), quickWrite, assessmentValueKey(quickWrite, fall, tww), 120);
    const newYearEntry = buildEntryRows([row], quickWrite, { schoolYear: "2026-2027", grade: "4" })[0];

    expect(newYearEntry[assessmentValueKey(quickWrite, fall, tww)]).toBeNull();
  });

  it("calculates Quick Write percentile from CWS rank within the current year and grade cohort", () => {
    const quickWrite = assessmentTemplates.find((assessment) => assessment.id === "quick-write") as AssessmentTemplate;
    const fall = quickWrite.rounds[0];
    const cws = quickWrite.fields.find((field) => field.id === "cws")!;
    const percentile = quickWrite.fields.find((field) => field.id === "quick-write-percentile")!;
    const context = { schoolYear: "2026-2027", grade: "3" };

    const rows = [
      { ...emptyRow(), id: "student-low", student: "Low Student" },
      { ...emptyRow(), id: "student-mid", student: "Mid Student" },
      { ...emptyRow(), id: "student-high", student: "High Student" }
    ].map((row, index) =>
      updateAssessmentRowFromTableEdit(row, quickWrite, assessmentValueKey(quickWrite, fall, cws), [10, 20, 30][index], context)
    );
    const entryRows = buildEntryRows(rows, quickWrite, context);
    const percentileKey = assessmentValueKey(quickWrite, fall, percentile);

    expect(entryRows[0][percentileKey]).toBe(17);
    expect(entryRows[1][percentileKey]).toBe(50);
    expect(entryRows[2][percentileKey]).toBe(83);
  });

  it("keeps the full Quick Write cohort when only one student is rendered", () => {
    const quickWrite = assessmentTemplates.find((assessment) => assessment.id === "quick-write") as AssessmentTemplate;
    const fall = quickWrite.rounds[0];
    const cws = quickWrite.fields.find((field) => field.id === "cws")!;
    const percentile = quickWrite.fields.find((field) => field.id === "quick-write-percentile")!;
    const context = { schoolYear: "2026-2027", grade: "3" };
    const cohortRows = [
      { ...emptyRow(), id: "student-low", student: "Low Student" },
      { ...emptyRow(), id: "student-mid", student: "Mid Student" },
      { ...emptyRow(), id: "student-high", student: "High Student" }
    ].map((row, index) =>
      updateAssessmentRowFromTableEdit(row, quickWrite, assessmentValueKey(quickWrite, fall, cws), [10, 20, 30][index], context)
    );

    const filteredEntry = buildEntryRows([cohortRows[0]], quickWrite, { ...context, cohortRows })[0];

    expect(filteredEntry[assessmentValueKey(quickWrite, fall, percentile)]).toBe(17);
  });

  it("calculates Percentage from Score divided by Total in the current section", () => {
    const template: AssessmentTemplate = {
      id: "sectioned-percentage",
      name: "Sectioned Percentage",
      category: "Custom",
      description: "Test percentage calculation.",
      gradeScope: "Grade 3",
      rounds: [{ id: "fall", label: "September / Fall", month: "September" }],
      sections: [{ id: "domain-a", name: "Domain A", roundIds: ["fall"] }],
      fields: [
        {
          id: "score",
          name: "Score",
          slug: "score",
          dataType: "integer",
          sectionIds: ["domain-a"],
          isRequired: false,
          isCalculated: false,
          visibility: "evaluators"
        },
        {
          id: "total",
          name: "Total",
          slug: "total",
          dataType: "integer",
          sectionIds: ["domain-a"],
          isRequired: false,
          isCalculated: false,
          visibility: "evaluators"
        },
        {
          id: "percentage",
          name: "%",
          slug: "percentage",
          dataType: "calculated",
          sectionIds: ["domain-a"],
          isRequired: false,
          isCalculated: true,
          calculationKey: "percentage",
          visibility: "evaluators"
        }
      ]
    };
    const fall = template.rounds[0];
    const section = template.sections![0];
    const score = template.fields[0];
    const total = template.fields[1];
    const percentage = template.fields[2];

    let row = emptyRow();
    row = updateAssessmentRowFromTableEdit(row, template, assessmentValueKey(template, fall, score, section), 18);
    row = updateAssessmentRowFromTableEdit(row, template, assessmentValueKey(template, fall, total, section), 24);
    const entry = buildEntryRows([row], template)[0];

    expect(entry[assessmentValueKey(template, fall, percentage, section)]).toBe(75);
  });
});

describe("assessment value validation", () => {
  it("accepts whole-number integers and rejects decimals, scientific notation, hex, negatives, and unsafe values", () => {
    const quickWrite = assessmentTemplates.find((assessment) => assessment.id === "quick-write") as AssessmentTemplate;
    const integerField = quickWrite.fields.find((field) => field.id === "tww")!;

    expect(validateAssessmentValue("42", integerField)).toMatchObject({ valid: true, value: 42 });
    expect(validateAssessmentValue("3.5", integerField).valid).toBe(false);
    expect(validateAssessmentValue("1e3", integerField).valid).toBe(false);
    expect(validateAssessmentValue("0x10", integerField).valid).toBe(false);
    expect(validateAssessmentValue(-1, integerField).valid).toBe(false);
    expect(validateAssessmentValue(Number.MAX_SAFE_INTEGER + 1, integerField).valid).toBe(false);
  });

  it("allows decimal percentages while enforcing the configured range and precision", () => {
    const quickWrite = assessmentTemplates.find((assessment) => assessment.id === "quick-write") as AssessmentTemplate;
    const percentageField = {
      ...quickWrite.fields[0],
      id: "percentage-input",
      name: "Percentage",
      slug: "percentage_input",
      dataType: "percentage" as const,
      validationConfig: { min: 0, max: 100, precision: 2 }
    };

    expect(validateAssessmentValue("12.5", percentageField)).toMatchObject({ valid: true, value: 12.5 });
    expect(validateAssessmentValue("12.345", percentageField).valid).toBe(false);
    expect(validateAssessmentValue("101", percentageField).valid).toBe(false);
  });

  it("prevents Score from exceeding the paired Total in either edit order", () => {
    const numeracy = assessmentTemplates.find((assessment) => assessment.id === "ab-ed-numeracy") as AssessmentTemplate;
    const fall = numeracy.rounds[0];
    const score = numeracy.fields.find((field) => field.groupLabel === "Comparing Numbers" && field.slug.endsWith("_score"))!;
    const total = numeracy.fields.find((field) => field.groupLabel === "Comparing Numbers" && field.slug.endsWith("_total"))!;
    const scoreKey = assessmentValueKey(numeracy, fall, score);
    const totalKey = assessmentValueKey(numeracy, fall, total);

    let row = updateAssessmentRowFromTableEdit(emptyRow(), numeracy, totalKey, 10);
    const beforeInvalidScore = row;
    row = updateAssessmentRowFromTableEdit(row, numeracy, scoreKey, 11);
    expect(row).toBe(beforeInvalidScore);
    expect(validateAssessmentTableEdit(row, numeracy, scoreKey, 11).valid).toBe(false);

    row = updateAssessmentRowFromTableEdit(row, numeracy, scoreKey, 8);
    const beforeInvalidTotal = row;
    row = updateAssessmentRowFromTableEdit(row, numeracy, totalKey, 7);
    expect(row).toBe(beforeInvalidTotal);
    expect(buildEntryRows([row], numeracy)[0][scoreKey]).toBe(8);
    expect(buildEntryRows([row], numeracy)[0][totalKey]).toBe(10);
  });
});
