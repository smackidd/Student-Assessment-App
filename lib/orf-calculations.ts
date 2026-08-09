export type OrfPassage = {
  wpm?: number | null;
  epm?: number | null;
};

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

export function calculateOrfPercentile(_median?: number | null) {
  // Percentiles are intentionally suppressed until an approved, grade- and
  // window-specific norms source is licensed, versioned, and validated.
  return null;
}

export function calculateOrfRound(passages: OrfPassage[]) {
  const cwpmValues = passages.map((passage) => calculateCwpm(passage.wpm, passage.epm));
  const median = calculateMedian(cwpmValues);

  return {
    cwpmValues,
    median,
    percentile: calculateOrfPercentile(median)
  };
}
