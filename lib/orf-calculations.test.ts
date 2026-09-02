import { describe, expect, it } from "vitest";
import {
  LEGACY_ORF_PERCENTILE_CALCULATION_KEYS,
  ORF_PERCENTILE_CALCULATION_KEYS,
  calculateCwpm,
  calculateMedian,
  calculateOrfPercentile,
  calculateOrfRound,
  resolveOrfPercentileCalculationKey,
  type OrfPercentileWindow
} from "./orf-calculations";

const publishedThresholds: Array<{
  grade: number;
  window: OrfPercentileWindow;
  thresholds: Array<[percentile: number, cwpm: number]>;
}> = [
  { grade: 1, window: "winter", thresholds: [[10, 9], [25, 16], [50, 29], [75, 59], [90, 97]] },
  { grade: 1, window: "spring", thresholds: [[10, 18], [25, 34], [50, 60], [75, 91], [90, 116]] },
  { grade: 2, window: "fall", thresholds: [[10, 23], [25, 36], [50, 50], [75, 84], [90, 111]] },
  { grade: 2, window: "winter", thresholds: [[10, 35], [25, 59], [50, 84], [75, 109], [90, 131]] },
  { grade: 2, window: "spring", thresholds: [[10, 43], [25, 72], [50, 100], [75, 124], [90, 148]] },
  { grade: 3, window: "fall", thresholds: [[10, 40], [25, 59], [50, 83], [75, 104], [90, 134]] },
  { grade: 3, window: "winter", thresholds: [[10, 62], [25, 79], [50, 97], [75, 137], [90, 161]] },
  { grade: 3, window: "spring", thresholds: [[10, 63], [25, 91], [50, 112], [75, 139], [90, 166]] },
  { grade: 4, window: "fall", thresholds: [[10, 60], [25, 75], [50, 94], [75, 125], [90, 153]] },
  { grade: 4, window: "winter", thresholds: [[10, 71], [25, 95], [50, 120], [75, 143], [90, 168]] },
  { grade: 4, window: "spring", thresholds: [[10, 83], [25, 105], [50, 133], [75, 160], [90, 184]] },
  { grade: 5, window: "fall", thresholds: [[10, 64], [25, 87], [50, 121], [75, 153], [90, 179]] },
  { grade: 5, window: "winter", thresholds: [[10, 84], [25, 109], [50, 133], [75, 160], [90, 183]] },
  { grade: 5, window: "spring", thresholds: [[10, 102], [25, 119], [50, 146], [75, 169], [90, 195]] },
  { grade: 6, window: "fall", thresholds: [[10, 89], [25, 112], [50, 132], [75, 159], [90, 185]] },
  { grade: 6, window: "winter", thresholds: [[10, 91], [25, 116], [50, 145], [75, 166], [90, 195]] },
  { grade: 6, window: "spring", thresholds: [[10, 91], [25, 122], [50, 146], [75, 173], [90, 204]] }
];

describe("ORF calculations", () => {
  it("calculates CWPM as WPM minus EPM", () => {
    expect(calculateCwpm(38, 14)).toBe(24);
  });

  it("does not return negative CWPM values", () => {
    expect(calculateCwpm(4, 9)).toBe(0);
  });

  it("returns null for incomplete CWPM inputs", () => {
    expect(calculateCwpm(null, 9)).toBeNull();
    expect(calculateCwpm(18, undefined)).toBeNull();
  });

  it("calculates medians while ignoring blank values", () => {
    expect(calculateMedian([24, null, 32, 19])).toBe(24);
    expect(calculateMedian([24, 32])).toBe(28);
    expect(calculateMedian([null, undefined])).toBeNull();
  });

  it("uses distinct Hasbrouck-Tindal fall, winter, and spring anchors", () => {
    expect(calculateOrfPercentile(83, 3, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBe(50);
    expect(calculateOrfPercentile(83, 3, ORF_PERCENTILE_CALCULATION_KEYS.winter)).toBe(25);
    expect(calculateOrfPercentile(83, 3, ORF_PERCENTILE_CALCULATION_KEYS.spring)).toBe(10);
  });

  it("returns a percentile anchor for MED values at and above 50", () => {
    expect(calculateOrfPercentile(50, 2, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBe(50);
    expect(calculateOrfPercentile(84, 2, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBe(75);
    expect(calculateOrfPercentile(500, 2, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBe(90);
  });

  it("matches every published 2017 threshold boundary", () => {
    for (const { grade, window, thresholds } of publishedThresholds) {
      for (const [percentile, cwpm] of thresholds) {
        expect(calculateOrfPercentile(cwpm, grade, ORF_PERCENTILE_CALCULATION_KEYS[window]))
          .toBe(percentile);
      }
    }
  });

  it("supports Grades 1 and 2 while honoring the missing Grade 1 fall norm", () => {
    expect(calculateOrfPercentile(29, 1, ORF_PERCENTILE_CALCULATION_KEYS.winter)).toBe(50);
    expect(calculateOrfPercentile(116, 1, ORF_PERCENTILE_CALCULATION_KEYS.spring)).toBe(90);
    expect(calculateOrfPercentile(29, 1, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBeNull();
    expect(calculateOrfPercentile(35, 2, ORF_PERCENTILE_CALCULATION_KEYS.winter)).toBe(10);
  });

  it("returns P1 below P10 and null for unsupported grades or keys", () => {
    expect(calculateOrfPercentile(39, 3, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBe(1);
    expect(calculateOrfPercentile(49, 7, ORF_PERCENTILE_CALCULATION_KEYS.spring)).toBeNull();
    expect(calculateOrfPercentile(49, 3, "orf_percentile")).toBeNull();
  });

  it("migrates generic and provisional keys by window and rejects the wrong window", () => {
    expect(resolveOrfPercentileCalculationKey("orf_percentile", "winter"))
      .toBe(ORF_PERCENTILE_CALCULATION_KEYS.winter);
    expect(resolveOrfPercentileCalculationKey(LEGACY_ORF_PERCENTILE_CALCULATION_KEYS.winter, "winter"))
      .toBe(ORF_PERCENTILE_CALCULATION_KEYS.winter);
    expect(resolveOrfPercentileCalculationKey(ORF_PERCENTILE_CALCULATION_KEYS.fall, "winter")).toBeNull();
  });

  it("calculates a full ORF round", () => {
    const result = calculateOrfRound(
      [
        { wpm: 38, epm: 14 },
        { wpm: 55, epm: 23 },
        { wpm: 44, epm: 24 }
      ],
      { grade: 3, calculationKey: ORF_PERCENTILE_CALCULATION_KEYS.fall }
    );

    expect(result.cwpmValues).toEqual([24, 32, 20]);
    expect(result.median).toBe(24);
    expect(result.percentile).toBe(1);
  });

  it("requires three complete passages before returning a percentile", () => {
    const result = calculateOrfRound(
      [{ wpm: 38, epm: 14 }, { wpm: 55, epm: 23 }],
      { grade: 3, calculationKey: ORF_PERCENTILE_CALCULATION_KEYS.fall }
    );

    expect(result.median).toBe(28);
    expect(result.percentile).toBeNull();
  });
});
