import { describe, expect, it } from "vitest";
import { ORF_PERCENTILE_CALCULATION_KEYS } from "./orf-calculations";
import {
  assessmentTemplates,
  normalizeAssessmentTemplates,
  type AssessmentTemplate
} from "./assessment-templates";

describe("assessment template normalization", () => {
  it("expands a saved legacy ORF percentile field into seasonal testing keys", () => {
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
  });
});
