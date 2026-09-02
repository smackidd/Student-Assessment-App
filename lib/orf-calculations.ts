export type OrfPassage = {
  wpm?: number | null;
  epm?: number | null;
};

export const ORF_PERCENTILE_CALCULATION_KEYS = {
  fall: "orf_percentile_hasbrouck_tindal_2017_fall",
  winter: "orf_percentile_hasbrouck_tindal_2017_winter",
  spring: "orf_percentile_hasbrouck_tindal_2017_spring"
} as const;

export const LEGACY_ORF_PERCENTILE_CALCULATION_KEYS = {
  fall: "orf_percentile_fastbridge2019_fall_test",
  winter: "orf_percentile_fastbridge2019_winter_test",
  spring: "orf_percentile_fastbridge2019_spring_test"
} as const;

export type OrfPercentileWindow = keyof typeof ORF_PERCENTILE_CALCULATION_KEYS;
export type OrfPercentileCalculationKey = (typeof ORF_PERCENTILE_CALCULATION_KEYS)[OrfPercentileWindow];

type PercentileThreshold = readonly [percentile: number, cwpm: number];

// Hasbrouck & Tindal's 2017 compiled ORF norms publish anchor scores at P10,
// P25, P50, P75, and P90. Values below P10 are reported as P1; values between
// anchors use the highest published anchor reached. Grade 1 has no fall norm.
const HASBROUCK_TINDAL_2017_THRESHOLDS: Readonly<
  Record<number, Readonly<Partial<Record<OrfPercentileWindow, readonly PercentileThreshold[]>>>>
> = {
  1: {
    winter: [[10, 9], [25, 16], [50, 29], [75, 59], [90, 97]],
    spring: [[10, 18], [25, 34], [50, 60], [75, 91], [90, 116]]
  },
  2: {
    fall: [[10, 23], [25, 36], [50, 50], [75, 84], [90, 111]],
    winter: [[10, 35], [25, 59], [50, 84], [75, 109], [90, 131]],
    spring: [[10, 43], [25, 72], [50, 100], [75, 124], [90, 148]]
  },
  3: {
    fall: [[10, 40], [25, 59], [50, 83], [75, 104], [90, 134]],
    winter: [[10, 62], [25, 79], [50, 97], [75, 137], [90, 161]],
    spring: [[10, 63], [25, 91], [50, 112], [75, 139], [90, 166]]
  },
  4: {
    fall: [[10, 60], [25, 75], [50, 94], [75, 125], [90, 153]],
    winter: [[10, 71], [25, 95], [50, 120], [75, 143], [90, 168]],
    spring: [[10, 83], [25, 105], [50, 133], [75, 160], [90, 184]]
  },
  5: {
    fall: [[10, 64], [25, 87], [50, 121], [75, 153], [90, 179]],
    winter: [[10, 84], [25, 109], [50, 133], [75, 160], [90, 183]],
    spring: [[10, 102], [25, 119], [50, 146], [75, 169], [90, 195]]
  },
  6: {
    fall: [[10, 89], [25, 112], [50, 132], [75, 159], [90, 185]],
    winter: [[10, 91], [25, 116], [50, 145], [75, 166], [90, 195]],
    spring: [[10, 91], [25, 122], [50, 146], [75, 173], [90, 204]]
  }
};

const WINDOW_BY_CALCULATION_KEY = Object.fromEntries(
  [ORF_PERCENTILE_CALCULATION_KEYS, LEGACY_ORF_PERCENTILE_CALCULATION_KEYS]
    .flatMap((keys) => Object.entries(keys).map(([window, key]) => [key, window]))
) as Record<string, OrfPercentileWindow>;

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
  const legacyKey = LEGACY_ORF_PERCENTILE_CALCULATION_KEYS[roundId as OrfPercentileWindow];
  if (!expectedKey) return null;
  if (key === "orf_percentile" || key === expectedKey || key === legacyKey) return expectedKey;
  return null;
}

export function calculateOrfPercentile(
  median?: number | null,
  grade?: string | number | null,
  calculationKey?: string | null
) {
  if (typeof median !== "number" || !Number.isFinite(median) || median < 0) return null;
  if (!calculationKey || !(calculationKey in WINDOW_BY_CALCULATION_KEY)) return null;

  const gradeMatch = String(grade ?? "").match(/\d+/);
  const gradeNumber = gradeMatch ? Number(gradeMatch[0]) : Number.NaN;
  const gradeThresholds = HASBROUCK_TINDAL_2017_THRESHOLDS[gradeNumber];
  if (!gradeThresholds) return null;

  const window = WINDOW_BY_CALCULATION_KEY[calculationKey];
  const thresholds = gradeThresholds[window];
  if (!thresholds?.length) return null;

  let percentile = 1;
  for (const [candidatePercentile, threshold] of thresholds) {
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
