import { describe, expect, it } from "vitest";
import { calculateCwpm, calculateMedian, calculateOrfPercentile, calculateOrfRound } from "./orf-calculations";

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

  it("only calculates ORF percentile when median is below 50", () => {
    expect(calculateOrfPercentile(54)).toBeNull();
    expect(calculateOrfPercentile(50)).toBeNull();
    expect(calculateOrfPercentile(45)).toBeNull();
    expect(calculateOrfPercentile(33)).toBeNull();
    expect(calculateOrfPercentile(23)).toBeNull();
    expect(calculateOrfPercentile(12)).toBeNull();
    expect(calculateOrfPercentile(7)).toBeNull();
  });

  it("calculates a full ORF round", () => {
    const result = calculateOrfRound([
      { wpm: 38, epm: 14 },
      { wpm: 55, epm: 23 },
      { wpm: 44, epm: 24 }
    ]);

    expect(result.cwpmValues).toEqual([24, 32, 20]);
    expect(result.median).toBe(24);
    expect(result.percentile).toBeNull();
  });
});
