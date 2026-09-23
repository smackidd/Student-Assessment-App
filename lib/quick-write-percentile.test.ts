import { describe, expect, it } from "vitest";
import {
  normalizeQuickWritePercentileRange,
  quickWriteEstimatedPercentileRange,
  quickWritePercentileRange,
  quickWriteWorkbookBelowOnePercent
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
    expect(normalizeQuickWritePercentileRange("10%")).toBe("10%");
    expect(normalizeQuickWritePercentileRange("0-10%")).toBe("0-10%");
    expect(normalizeQuickWritePercentileRange("10-25%")).toBe("10-25%");
    expect(normalizeQuickWritePercentileRange("25-50%")).toBe("25-50%");
    expect(normalizeQuickWritePercentileRange("25–50%")).toBe("25-50%");
    expect(normalizeQuickWritePercentileRange("25-10%")).toBeNull();
    expect(normalizeQuickWritePercentileRange("101%")).toBeNull();
    expect(normalizeQuickWritePercentileRange("10-101%")).toBeNull();
    expect(normalizeQuickWritePercentileRange("10% (cohort est.)")).toBeNull();
    expect(normalizeQuickWritePercentileRange("not a percentile")).toBeNull();
  });

  it.each([
    ["3", "winter", 1, true],
    ["3", "winter", 2, false],
    ["3", "spring", 2, true],
    ["3", "spring", 3, false],
    ["4", "fall", 0, true],
    ["4", "fall", 1, false],
    ["4", "winter", 3, true],
    ["4", "winter", 4, false],
    ["3", "fall", 0, false],
    ["4", "spring", 0, false],
    ["5", "winter", 0, false]
  ] as const)("checks the workbook-backed <1%% cutoff for grade %s %s CWS %s", (grade, windowId, cws, expected) => {
    expect(quickWriteWorkbookBelowOnePercent(grade, windowId, cws)).toBe(expected);
  });

  it("does not infer a workbook cutoff without a valid grade or CWS", () => {
    expect(quickWriteWorkbookBelowOnePercent(undefined, "winter", 0)).toBe(false);
    expect(quickWriteWorkbookBelowOnePercent("3", "winter", -1)).toBe(false);
    expect(quickWriteWorkbookBelowOnePercent("3", "winter", 0.5)).toBe(false);
  });
});
