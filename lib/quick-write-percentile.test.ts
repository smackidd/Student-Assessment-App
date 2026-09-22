import { describe, expect, it } from "vitest";
import {
  normalizeQuickWritePercentileRange,
  quickWriteEstimatedPercentileRange,
  quickWritePercentileRange
} from "./quick-write-percentile";

describe("Quick Write percentile ranges", () => {
  it.each([
    [0, "<1%"],
    [0.99, "<1%"],
    [1, "1-19%"],
    [19.99, "1-19%"],
    [20, "20-39%"],
    [39.99, "20-39%"],
    [40, "40-59%"],
    [59.99, "40-59%"],
    [60, "60-79%"],
    [79.99, "60-79%"],
    [80, "80-99%"],
    [99.99, "80-99%"],
    [100, ">99%"]
  ] as const)("maps percentile %s to %s", (percentile, expected) => {
    expect(quickWritePercentileRange(percentile)).toBe(expected);
  });

  it("rejects invalid percentiles and preserves workbook-style labels", () => {
    expect(quickWritePercentileRange(-1)).toBeNull();
    expect(quickWritePercentileRange(101)).toBeNull();
    expect(quickWritePercentileRange(Number.NaN)).toBeNull();
    expect(normalizeQuickWritePercentileRange(" 20–39% ")).toBe("20-39%");
    expect(normalizeQuickWritePercentileRange("<1%")).toBe("<1%");
    expect(normalizeQuickWritePercentileRange(17)).toBe("1-19%");
    expect(quickWriteEstimatedPercentileRange(17)).toBe("1-19% (cohort est.)");
    expect(normalizeQuickWritePercentileRange("1-19% (cohort est.)")).toBe("1-19% (cohort est.)");
    expect(normalizeQuickWritePercentileRange("not a percentile")).toBeNull();
  });
});
