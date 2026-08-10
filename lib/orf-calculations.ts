export type OrfPassage = {
  wpm?: number | null;
  epm?: number | null;
};

export const ORF_PERCENTILE_CALCULATION_KEYS = {
  fall: "orf_percentile_fastbridge2019_fall_test",
  winter: "orf_percentile_fastbridge2019_winter_test",
  spring: "orf_percentile_fastbridge2019_spring_test"
} as const;

export type OrfPercentileWindow = keyof typeof ORF_PERCENTILE_CALCULATION_KEYS;
export type OrfPercentileCalculationKey = (typeof ORF_PERCENTILE_CALCULATION_KEYS)[OrfPercentileWindow];

type PercentileThreshold = readonly [percentile: number, cwpm: number];

// Test-only subset of the public FastBridge CBMreading 2019 tables. Because the
// school rule suppresses ORF percentile at MED >= 50, only reachable thresholds
// below 50 CWPM are embedded here. Values below the first threshold rank as P1.
const FASTBRIDGE_2019_TEST_THRESHOLDS: Readonly<
  Record<number, Readonly<Record<OrfPercentileWindow, readonly PercentileThreshold[]>>>
> = {
  3: {
    fall: [[1, 8], [2, 13], [3, 17], [4, 20], [5, 22], [6, 25], [7, 28], [8, 31], [9, 34], [10, 37], [11, 39], [12, 43], [13, 46], [14, 49]],
    winter: [[1, 14], [2, 21], [3, 25], [4, 31], [5, 35], [6, 40], [7, 46]],
    spring: [[1, 19], [2, 27], [3, 33], [4, 41], [5, 49]]
  },
  4: {
    fall: [[1, 16], [2, 28], [3, 37], [4, 45]],
    winter: [[1, 26], [2, 42]],
    spring: [[1, 31]]
  },
  5: {
    fall: [[1, 32], [2, 47]],
    winter: [[1, 41]],
    spring: []
  },
  6: {
    fall: [[1, 32], [2, 47]],
    winter: [[1, 41]],
    spring: [[1, 48]]
  },
  7: { fall: [], winter: [], spring: [] },
  8: {
    fall: [[1, 46]],
    winter: [[1, 28]],
    spring: []
  }
};

const WINDOW_BY_CALCULATION_KEY = Object.fromEntries(
  Object.entries(ORF_PERCENTILE_CALCULATION_KEYS).map(([window, key]) => [key, window])
) as Record<OrfPercentileCalculationKey, OrfPercentileWindow>;

export function calculateCwpm(wpm?: number | null, epm?: number | null) {
  if (typeof wpm !== "number" || typeof epm !== "number") return null;
  return Math.max(wpm - epm, 0);
}

export function calculateMedian(values: Array<number | null | undefined>) {
  const sorted = values
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);

  if (sorted.length === 0) return null;

  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }

  return (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

export function resolveOrfPercentileCalculationKey(key: string | undefined, roundId: string) {
  const expectedKey = ORF_PERCENTILE_CALCULATION_KEYS[roundId as OrfPercentileWindow];
  if (!expectedKey) return null;
  if (key === "orf_percentile") return expectedKey;
  return key === expectedKey ? expectedKey : null;
}

export function calculateOrfPercentile(
  median?: number | null,
  grade?: string | number | null,
  calculationKey?: string | null
) {
  if (typeof median !== "number" || !Number.isFinite(median) || median < 0 || median >= 50) return null;
  if (!calculationKey || !(calculationKey in WINDOW_BY_CALCULATION_KEY)) return null;

  const gradeMatch = String(grade ?? "").match(/\d+/);
  const gradeNumber = gradeMatch ? Number(gradeMatch[0]) : Number.NaN;
  const gradeThresholds = FASTBRIDGE_2019_TEST_THRESHOLDS[gradeNumber];
  if (!gradeThresholds) return null;

  const window = WINDOW_BY_CALCULATION_KEY[calculationKey as OrfPercentileCalculationKey];
  let percentile = 1;
  for (const [candidatePercentile, threshold] of gradeThresholds[window]) {
    if (median < threshold) break;
    percentile = candidatePercentile;
  }
  return percentile;
}

export function calculateOrfRound(
  passages: OrfPassage[],
  options: { grade?: string | number | null; calculationKey?: string | null } = {}
) {
  const cwpmValues = passages.map((passage) => calculateCwpm(passage.wpm, passage.epm));
  const median = calculateMedian(cwpmValues);
  const hasThreePassages = cwpmValues.length === 3 && cwpmValues.every((value) => typeof value === "number");

  return {
    cwpmValues,
    median,
    percentile: hasThreePassages
      ? calculateOrfPercentile(median, options.grade, options.calculationKey)
      : null
  };
}
