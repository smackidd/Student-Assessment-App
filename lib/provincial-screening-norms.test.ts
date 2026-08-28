import { describe, expect, it } from "vitest";
import {
  CC3_NORMS,
  PROVINCIAL_NUMERACY_NORMS,
  calculateNumeracyWeightedScore
} from "./provincial-screening-norms";

describe("photographed provincial screening norms", () => {
  it("records every CC3 support cutoff from the Fall, Winter, and Spring sheets", () => {
    const cutoffs = Object.fromEntries(Object.entries(CC3_NORMS).map(([window, grades]) => [
      window,
      Object.fromEntries(Object.entries(grades).map(([grade, norm]) => [
        grade,
        [
          norm!.regular_words.requiringSupportMax,
          norm!.irregular_words.requiringSupportMax,
          norm!.non_words.requiringSupportMax
        ]
      ]))
    ]));

    expect(cutoffs).toEqual({
      fall: { "2": [7, 3, 2], "3": [21, 12, 7], "4": [27, 17, 10] },
      winter: { "1": [3, 0, 1], "2": [17, 8, 7], "3": [28, 16, 13], "4": [29, 18, 12] },
      spring: { "1": [7, 3, 3], "2": [20, 11, 9], "3": [28, 18, 13], "4": [31, 21, 17] }
    });
  });

  it("records the photographed weighted-total support cutoffs for every available numeracy grade", () => {
    const cutoffs = Object.fromEntries(Object.entries(PROVINCIAL_NUMERACY_NORMS).map(([window, grades]) => [
      window,
      Object.fromEntries(Object.entries(grades).map(([grade, norm]) => [grade, norm!.weightedSupportMax]))
    ]));

    expect(cutoffs).toEqual({
      fall: { "1": 22, "2": 29, "3": 39, "4": 28 },
      winter: { K: 37, "1": 43, "2": 39, "3": 48, "4": 35 },
      spring: { "1": 54, "2": 42, "3": 49, "4": 41 }
    });
  });

  it("uses the Grade 3 and Grade 4 component maximums and weights shown in the sheets", () => {
    for (const window of ["fall", "winter", "spring"] as const) {
      expect(PROVINCIAL_NUMERACY_NORMS[window]["3"]!.components.map(({ max, weight }) => [max, weight])).toEqual([
        [40, 15], [15, 20], [10, 15], [39, 12.5], [39, 12.5], [16, 10], [56, 15]
      ]);
      expect(PROVINCIAL_NUMERACY_NORMS[window]["4"]!.components.map(({ max, weight }) => [max, weight])).toEqual([
        [15, 15], [18, 15], [42, 10], [42, 10], [22, 15], [25, 10], [25, 10], [6, 15]
      ]);
    }
  });

  it("rounds the weighted screener formula to a whole-number score out of 100", () => {
    const norm = PROVINCIAL_NUMERACY_NORMS.spring["3"]!;
    const maximumScores = Object.fromEntries(norm.components.map((item) => [item.component, item.max]));
    expect(calculateNumeracyWeightedScore(norm, maximumScores)).toBe(100);
  });
});
