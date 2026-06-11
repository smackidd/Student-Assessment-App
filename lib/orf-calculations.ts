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

export function calculateOrfPercentile(median?: number | null) {
  if (typeof median !== "number") return null;
  if (median >= 50) return null;

  if (median >= 40) return 25;
  if (median >= 30) return 16;
  if (median >= 20) return 10;
  if (median >= 10) return 5;
  return 1;
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
