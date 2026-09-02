import { describe, expect, it } from "vitest";
import {
  LEGACY_ORF_PERCENTILE_CALCULATION_KEYS,
  ORF_PERCENTILE_CALCULATION_KEYS
} from "./orf-calculations";
import {
  assessmentTemplates,
  normalizeAssessmentTemplates,
  type AssessmentTemplate
} from "./assessment-templates";

describe("assessment template normalization", () => {
  it("expands a saved generic ORF percentile field into seasonal 2017 keys", () => {
    const currentOrf = assessmentTemplates.find((template) => template.id === "orf") as AssessmentTemplate;
    const legacyOrf: AssessmentTemplate = {
      ...currentOrf,
      fields: [
        ...currentOrf.fields.filter((field) => field.name !== "%ile"),
        {
          id: "percentile",
          name: "%ile",
          slug: "percentile",
          dataType: "calculated",
          isRequired: false,
          isCalculated: true,
          calculationKey: "orf_percentile",
          visibility: "evaluators"
        }
      ]
    };

    const normalized = normalizeAssessmentTemplates([legacyOrf])[0];
    const percentileFields = normalized.fields.filter((field) => field.name === "%ile");

    expect(percentileFields).toHaveLength(3);
    expect(percentileFields.map((field) => field.calculationKey)).toEqual([
      ORF_PERCENTILE_CALCULATION_KEYS.fall,
      ORF_PERCENTILE_CALCULATION_KEYS.winter,
      ORF_PERCENTILE_CALCULATION_KEYS.spring
    ]);
    expect(percentileFields.map((field) => field.roundIds)).toEqual([["fall"], ["winter"], ["spring"]]);
    expect(normalized.gradeScope).toBe("Grades 1-6");
  });

  it("upgrades saved provisional seasonal ORF keys without losing their window", () => {
    const currentOrf = assessmentTemplates.find((template) => template.id === "orf") as AssessmentTemplate;
    const saved: AssessmentTemplate = {
      ...currentOrf,
      fields: currentOrf.fields.map((field) => field.roundIds?.includes("winter")
        ? { ...field, calculationKey: LEGACY_ORF_PERCENTILE_CALCULATION_KEYS.winter }
        : field)
    };

    const normalized = normalizeAssessmentTemplates([saved])[0];
    const winterPercentile = normalized.fields.find((field) => field.roundIds?.includes("winter"));

    expect(winterPercentile?.calculationKey).toBe(ORF_PERCENTILE_CALCULATION_KEYS.winter);
    expect(winterPercentile?.roundIds).toEqual(["winter"]);
  });

  it("adds CC3 to older saved workspaces and keeps both normed assessments scoped to Grades 3 and 4", () => {
    const olderTemplates = assessmentTemplates.filter((template) => template.id !== "cc3");
    const normalized = normalizeAssessmentTemplates(olderTemplates);
    const cc3 = normalized.find((template) => template.id === "cc3")!;
    const numeracy = normalized.find((template) => template.id === "ab-ed-numeracy")!;

    expect(cc3.gradeScope).toBe("Grades 3-4");
    expect(cc3.fields.find((field) => field.calculationKey === "cc3_requires_support")?.displayStyle).toBe("checkbox");
    expect(numeracy.gradeScope).toBe("Grades 3-4");
    expect(numeracy.fields.find((field) => field.calculationKey === "provincial_numeracy_requires_support")?.displayStyle)
      .toBe("checkbox");
  });

  it("upgrades a sectioned spreadsheet-import numeracy definition without changing its existing section ids", () => {
    const currentNumeracy = assessmentTemplates.find((template) => template.id === "ab-ed-numeracy")!;
    const legacyNumeracy: AssessmentTemplate = {
      ...currentNumeracy,
      sections: [
        { id: "comparing_numbers", name: "Comparing Numbers", roundIds: ["fall", "winter", "spring"] },
        { id: "writing_numbers", name: "Writing Numbers", roundIds: ["fall", "winter", "spring"] }
      ],
      fields: [
        {
          id: "score", name: "score", slug: "score", dataType: "integer",
          sectionIds: ["comparing_numbers", "writing_numbers"], isRequired: false, isCalculated: false, visibility: "evaluators"
        },
        {
          id: "total", name: "total", slug: "total", dataType: "integer",
          sectionIds: ["comparing_numbers", "writing_numbers"], isRequired: false, isCalculated: false, visibility: "evaluators"
        }
      ]
    };

    const normalized = normalizeAssessmentTemplates([legacyNumeracy])[0];
    expect(normalized.sections?.find((section) => section.id === "comparing_numbers")?.gradeIds).toEqual(["3"]);
    expect(normalized.sections?.some((section) => section.name === "Fractions" && section.gradeIds?.includes("4"))).toBe(true);
    expect(normalized.fields.find((field) => field.id === "total")?.calculationKey)
      .toBe("provincial_numeracy_component_total");
  });

  it("applies the norm calculations to saved school-year snapshots as well as the current definition", () => {
    const cc3 = assessmentTemplates.find((template) => template.id === "cc3")!;
    const legacyFields = cc3.fields
      .filter((field) => field.id !== "requires-additional-supports")
      .map((field) => field.id === "total"
        ? { ...field, dataType: "integer" as const, isCalculated: false, calculationKey: undefined }
        : field);
    const saved: AssessmentTemplate = {
      ...cc3,
      fields: legacyFields,
      yearDefinitions: {
        "2025-2026": {
          name: cc3.name,
          description: cc3.description,
          gradeScope: cc3.gradeScope,
          rounds: cc3.rounds,
          sections: cc3.sections,
          fields: legacyFields
        }
      }
    };

    const normalized = normalizeAssessmentTemplates([saved])[0];
    const yearFields = normalized.yearDefinitions?.["2025-2026"].fields ?? [];
    expect(yearFields.find((field) => field.id === "total")?.calculationKey).toBe("cc3_component_total");
    expect(yearFields.some((field) => field.calculationKey === "cc3_requires_support")).toBe(true);
  });
});
