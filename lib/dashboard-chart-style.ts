export const DASHBOARD_CHART_STYLE = {
  lineWidthPx: 2.5,
  markerRadiusPx: 4,
  gridColor: "#d4dcdf",
  gridDashArray: "3 4",
  yearBandColors: ["#f0f7f4", "#f4f2fb"],
  yearBoundaryColor: "#88939c",
  axisTextColor: "#243447",
  valueFontSizePx: 12
} as const;

const palette = ["#243447", "#6751bf", "#0f766e", "#af460e", "#2563ab", "#a62662", "#52643a"];

/** Stable sRGB colors for SVG, PDF and native Excel charts, in series/slice order. */
export function dashboardChartSeriesColor(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) return palette[0];
  if (index < palette.length) return palette[index];
  // Spread additional hues around the wheel; keep labels dark enough for a white plot.
  const n = index - palette.length;
  const hue = (31 + n * 137.508) % 360;
  const lightness = [0.33, 0.29, 0.37][n % 3];
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const v = lightness - 0.64 * lightness * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * v).toString(16).padStart(2, "0");
  };
  return "#" + channel(0) + channel(8) + channel(4);
}
