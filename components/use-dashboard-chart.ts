import { useMemo } from "react";
import { dashboardChartSource, dashboardChartView, type ChartContext } from "@/lib/dashboard-chart-model";
import type { DashboardFilters } from "@/lib/dashboard-filters";

export function useDashboardChart({ rows, placements, schoolYears, templates, classroomGroups, assessmentForYear,
  scaleCodesForField }: ChartContext, { chartType, assessmentId, fieldKeys, homerooms, sectionIds, teamId,
  studentIds, roundId, years }: DashboardFilters) {
  const source = useMemo(() => dashboardChartSource({
    rows, placements, schoolYears, templates, classroomGroups, assessmentForYear, scaleCodesForField
  }, { chartType, assessmentId, fieldKeys, homerooms, sectionIds, teamId, studentIds, roundId }),
  [rows, placements, schoolYears, templates, classroomGroups, assessmentForYear, scaleCodesForField,
    chartType, assessmentId, fieldKeys, homerooms, sectionIds, teamId, studentIds, roundId]);
  const view = useMemo(() => dashboardChartView(source.observations, { years, chartType }), [source, years, chartType]);
  return { ...source, ...view };
}
