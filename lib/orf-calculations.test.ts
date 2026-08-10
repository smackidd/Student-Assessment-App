import { describe, expect, it } from "vitest";
import {
  ORF_PERCENTILE_CALCULATION_KEYS,
  calculateCwpm,
  calculateMedian,
  calculateOrfPercentile,
  calculateOrfRound,
  resolveOrfPercentileCalculationKey
} from "./orf-calculations";

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

  it("uses distinct FastBridge-derived fall, winter, and spring testing thresholds", () => {
    expect(calculateOrfPercentile(49, 3, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBe(14);
    expect(calculateOrfPercentile(49, 3, ORF_PERCENTILE_CALCULATION_KEYS.winter)).toBe(7);
    expect(calculateOrfPercentile(49, 3, ORF_PERCENTILE_CALCULATION_KEYS.spring)).toBe(5);
  });

  it("keeps the school rule that ORF MED at or above 50 is blank", () => {
    expect(calculateOrfPercentile(50, 3, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBeNull();
    expect(calculateOrfPercentile(54, 3, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBeNull();
  });

  it("returns P1 below the first reachable threshold and null for unsupported grades or keys", () => {
    expect(calculateOrfPercentile(7, 3, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBe(1);
    expect(calculateOrfPercentile(49, 8, ORF_PERCENTILE_CALCULATION_KEYS.spring)).toBe(1);
    expect(calculateOrfPercentile(49, 9, ORF_PERCENTILE_CALCULATION_KEYS.fall)).toBeNull();
    expect(calculateOrfPercentile(49, 3, "orf_percentile")).toBeNull();
  });

  it("migrates the legacy key by window and rejects a seasonal key on the wrong window", () => {
    expect(resolveOrfPercentileCalculationKey("orf_percentile", "winter"))
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
    expect(result.percentile).toBe(5);
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
