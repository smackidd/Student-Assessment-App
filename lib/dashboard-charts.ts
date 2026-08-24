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

export function compactDashboardChartLabel(label: string, maxCharacters = 18) {
  const normalized = label.trim().replace(/\s+/g, " ");
  const requestedCharacters = Number.isFinite(maxCharacters) ? Math.floor(maxCharacters) : 18;
  const visibleCharacters = Math.max(5, requestedCharacters);
  if (normalized.length <= visibleCharacters) return normalized;
  return `${normalized.slice(0, visibleCharacters).trimEnd()}...`;
}

export function compactDashboardLegendLabel(label: string, maxCharacters = 32) {
  const normalized = label.trim().replace(/\s+/g, " ");
  const separator = " / ";
  const separatorIndex = normalized.lastIndexOf(separator);
  const requestedCharacters = Number.isFinite(maxCharacters) ? Math.floor(maxCharacters) : 32;
  const visibleCharacters = Math.max(5, requestedCharacters);
  if (separatorIndex < 0 || normalized.length <= visibleCharacters) {
    return compactDashboardChartLabel(normalized, visibleCharacters);
  }

  const assessment = normalized.slice(0, separatorIndex);
  const field = normalized.slice(separatorIndex + separator.length);
  const fieldCharacters = Math.max(5, Math.min(field.length, Math.ceil((visibleCharacters - separator.length) / 2)));
  const assessmentCharacters = Math.max(5, visibleCharacters - separator.length - fieldCharacters);
  return `${compactDashboardChartLabel(assessment, assessmentCharacters)}${separator}${compactDashboardChartLabel(field, fieldCharacters)}`;
}

export function dashboardAxisLabelCharacterLimit(chartWidth: number, pointCount: number) {
  return dashboardLabelCharacterLimit(chartWidth, pointCount, 4, 18);
}

export function dashboardLegendLabelCharacterLimit(chartWidth: number, seriesCount: number) {
  return dashboardLabelCharacterLimit(chartWidth, seriesCount, 32, 32);
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

function dashboardLabelCharacterLimit(
  chartWidth: number,
  itemCount: number,
  reservedPixels: number,
  maximumCharacters: number
) {
  if (!Number.isFinite(chartWidth) || chartWidth <= 0 || !Number.isFinite(itemCount) || itemCount <= 0) {
    return maximumCharacters;
  }

  const usableWidth = Math.max(0, chartWidth - 72);
  const pixelsPerItem = usableWidth / itemCount;
  const estimatedCharacters = Math.floor((pixelsPerItem - reservedPixels) / 7);
  return Math.max(5, Math.min(maximumCharacters, estimatedCharacters));
}
