import { describe, expect, it } from "vitest";
import { assessmentTemplates, type AssessmentTemplate } from "./assessment-templates";
import {
  assessmentValueKey,
  buildEntryRows,
  sectionsForAssessmentRound,
  updateAssessmentRowFromTableEdit
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

  it("does not copy a 1st passage WPM/EPM edit into other passages and recalculates MED and percentile", () => {
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
    expect(entry[percentileKey]).toBe(25);
  });

  it("recalculates MED and percentile when CWPM cells are entered directly", () => {
    const orf = customOrfTemplate();
    const fall = orf.rounds[0];
    const sections = sectionsForAssessmentRound(orf, fall);
    const cwpm = orf.fields.find((field) => field.id === "orf_cwpm_5")!;
    const median = orf.fields.find((field) => field.id === "orf_med_4")!;
    const percentile = orf.fields.find((field) => field.id === "orf_ile_5")!;

    let row = emptyRow();
    row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, cwpm, sections[0]), 42);
    row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, cwpm, sections[1]), 24);
    row = updateAssessmentRowFromTableEdit(row, orf, assessmentValueKey(orf, fall, cwpm, sections[2]), 15);
    const entry = buildEntryRows([row], orf)[0];

    expect(entry[assessmentValueKey(orf, fall, median)]).toBe(24);
    expect(entry[assessmentValueKey(orf, fall, percentile)]).toBe(10);
  });

  it("keeps the same student's ORF values separate by school year and grade", () => {
    const orf = customOrfTemplate();
    const fall = orf.rounds[0];
    const sections = sectionsForAssessmentRound(orf, fall);
    const cwpm = orf.fields.find((field) => field.id === "orf_cwpm_5")!;
    const median = orf.fields.find((field) => field.id === "orf_med_4")!;

    let row = emptyRow();
    row = updateAssessmentRowFromTableEdit(
      row,
      orf,
      assessmentValueKey(orf, fall, cwpm, sections[0]),
      67,
      { schoolYear: "2024-2025", grade: "3" }
    );
    row = updateAssessmentRowFromTableEdit(
      row,
      orf,
      assessmentValueKey(orf, fall, cwpm, sections[0]),
      73,
      { schoolYear: "2025-2026", grade: "4" }
    );
    row = updateAssessmentRowFromTableEdit(
      row,
      orf,
      assessmentValueKey(orf, fall, cwpm, sections[0]),
      75,
      { schoolYear: "2026-2027", grade: "5" }
    );

    expect(buildEntryRows([row], orf, { schoolYear: "2024-2025", grade: "3" })[0][assessmentValueKey(orf, fall, median)]).toBe(67);
    expect(buildEntryRows([row], orf, { schoolYear: "2025-2026", grade: "4" })[0][assessmentValueKey(orf, fall, median)]).toBe(73);
    expect(buildEntryRows([row], orf, { schoolYear: "2026-2027", grade: "5" })[0][assessmentValueKey(orf, fall, median)]).toBe(75);
  });
});
