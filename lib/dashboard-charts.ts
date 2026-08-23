export type DashboardChartAxisPoint = {
  axisKey: string;
  year: string;
  window: string;
  section: string;
};

export type DashboardYearGroup = {
  year: string;
  firstAxisKey: string;
  lastAxisKey: string;
  labelAxisKey: string;
};

export function compactDashboardAxisLabel(label: string, maxLength = 18) {
  const normalized = label.trim().replace(/\s+/g, " ");
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return "…";

  const available = maxLength - 1;
  const candidate = normalized.slice(0, available).trimEnd();
  const lastSpace = candidate.lastIndexOf(" ");
  const prefix = lastSpace >= Math.floor(available * 0.55) ? candidate.slice(0, lastSpace) : candidate;
  return `${prefix.trimEnd()}…`;
}

export function dashboardYearGroups(points: DashboardChartAxisPoint[]): DashboardYearGroup[] {
  const groups: Array<{ year: string; points: DashboardChartAxisPoint[] }> = [];

  points.forEach((point) => {
    const current = groups[groups.length - 1];
    if (current?.year === point.year) {
      current.points.push(point);
    } else {
      groups.push({ year: point.year, points: [point] });
    }
  });

  return groups.map(({ year, points: yearPoints }) => ({
    year,
    firstAxisKey: yearPoints[0].axisKey,
    lastAxisKey: yearPoints[yearPoints.length - 1].axisKey,
    labelAxisKey: yearPoints[Math.floor(yearPoints.length / 2)].axisKey
  }));
}

export function labelDashboardYears<T extends DashboardChartAxisPoint>(points: T[]): Array<T & { yearLabel: string }> {
  const labels = new Map(dashboardYearGroups(points).map((group) => [group.labelAxisKey, group.year]));
  return points.map((point) => ({ ...point, yearLabel: labels.get(point.axisKey) ?? "" }));
}

export function formatDashboardTooltipLabel(point: DashboardChartAxisPoint | null | undefined) {
  if (!point) return "";
  return [point.year, point.window, point.section].filter(Boolean).join(" · ");
}

export function addDashboardChart(chartIds: string[], chartId: string) {
  return chartIds.includes(chartId) ? chartIds : [...chartIds, chartId];
}

export function removeDashboardChart(chartIds: string[], chartId: string) {
  if (chartIds.length <= 1) return chartIds;
  return chartIds.filter((id) => id !== chartId);
}
