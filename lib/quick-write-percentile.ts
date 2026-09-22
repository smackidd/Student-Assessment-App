/**
 * Quick Write workbook labels are ranges, but the workbooks do not include a
 * complete grade/window norms table. These bands classify the app's provisional
 * within-cohort CWS percentile rank; they are not a provincial norm lookup.
 */
export const QUICK_WRITE_PERCENTILE_RANGES = [
  "<1%",
  "1-19%",
  "20-39%",
  "40-59%",
  "60-79%",
  "80-99%",
  ">99%"
] as const;

export type QuickWritePercentileRange = (typeof QUICK_WRITE_PERCENTILE_RANGES)[number];
export type QuickWritePercentileDisplay = QuickWritePercentileRange | `${QuickWritePercentileRange} (cohort est.)`;

export function quickWritePercentileRange(percentile: number): QuickWritePercentileRange | null {
  if (!Number.isFinite(percentile) || percentile < 0 || percentile > 100) return null;
  if (percentile < 1) return "<1%";
  if (percentile < 20) return "1-19%";
  if (percentile < 40) return "20-39%";
  if (percentile < 60) return "40-59%";
  if (percentile < 80) return "60-79%";
  if (percentile < 100) return "80-99%";
  return ">99%";
}

export function quickWriteEstimatedPercentileRange(percentile: number): QuickWritePercentileDisplay | null {
  const range = quickWritePercentileRange(percentile);
  return range ? `${range} (cohort est.)` : null;
}

export function normalizeQuickWritePercentileRange(value: unknown): QuickWritePercentileDisplay | null {
  if (typeof value === "number") return quickWritePercentileRange(value);
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[–—]/g, "-").replace(/\s+/g, "");
  const estimated = normalized.endsWith("(cohortest.)");
  const band = estimated ? normalized.slice(0, -"(cohortest.)".length) : normalized;
  if (QUICK_WRITE_PERCENTILE_RANGES.some((range) => range === band)) {
    return estimated ? `${band} (cohort est.)` as QuickWritePercentileDisplay : band as QuickWritePercentileRange;
  }
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
    return quickWritePercentileRange(Number(normalized));
  }
  return null;
}
