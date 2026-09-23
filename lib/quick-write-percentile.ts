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
export type QuickWriteWorkbookPercentileLabel = `${number}%` | `${number}-${number}%`;
export type QuickWritePercentileDisplay = QuickWritePercentileRange | QuickWriteWorkbookPercentileLabel | `${QuickWritePercentileRange} (cohort est.)`;

// The Grade 3/4 CBM workbooks show adjacent integer CWS scores on opposite
// sides of the <1% boundary in these windows. No complete norms table exists.
// Grade 3: January H7:I7 (1, <1%) / H10:I10 (2, 1-19%);
//          May L5:M5 (2, <1%) / L7:M7 (3, 1-19%).
// Grade 4: September D4:E4 (0, <1%) / D5:E5 (1, 1-19%);
//          February H7:I7 (3, <1%) / H4:I4 (4, 1-19%).
const QUICK_WRITE_BELOW_ONE_CWS_MAX: Record<string, Record<string, number>> = {
  "3": { winter: 1, spring: 2 },
  "4": { fall: 0, winter: 3 }
};

export function quickWriteWorkbookBelowOnePercent(grade: string | undefined, windowId: string, cws: number): boolean {
  if (!grade || !Number.isSafeInteger(cws) || cws < 0) return false;
  const maximum = QUICK_WRITE_BELOW_ONE_CWS_MAX[grade]?.[windowId];
  return maximum !== undefined && cws <= maximum;
}

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
  // Imported workbook labels use their own bands; keep them instead of replacing
  // them with the app's provisional cohort bands.
  const workbookLabel = !estimated && /^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?%$/.exec(band);
  if (workbookLabel) {
    const lower = Number(workbookLabel[1]);
    const upper = Number(workbookLabel[2] ?? workbookLabel[1]);
    if (lower >= 0 && lower <= upper && upper <= 100) {
      return band as QuickWriteWorkbookPercentileLabel;
    }
  }
  if (/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
    return quickWritePercentileRange(Number(normalized));
  }
  return null;
}
