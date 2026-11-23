import type { AssessmentFieldTemplate, AssessmentTemplate } from "./assessment-templates";
import { averageDashboardValues } from "./dashboard-charts";
import { dashboardChartSelection, dashboardCohort, dashboardFilterOptions, dashboardObservations,
  type DashboardFilters, type DashboardTeam } from "./dashboard-filters";
import type { StudentPlacement } from "./overview-state";
import type { OrfResultRow } from "./sample-results";

export type ChartContext = {
  rows: OrfResultRow[];
  placements: StudentPlacement[];
  schoolYears: string[];
  templates: AssessmentTemplate[];
  classroomGroups: readonly DashboardTeam[];
  assessmentForYear: (assessment: AssessmentTemplate, year: string) => AssessmentTemplate;
  scaleCodesForField: (field: AssessmentFieldTemplate) => string[];
};

type SourceFilters = Omit<DashboardFilters, "years">;

export function dashboardChartSource(context: ChartContext, filters: SourceFilters) {
  const { rows, placements, schoolYears, templates, classroomGroups, assessmentForYear, scaleCodesForField } = context;
  const { assessmentId, fieldKeys, roundId, sectionIds } = filters;
  const selectedAssessment = assessmentId ? templates.find((item) => item.id === assessmentId) : templates[0];
  const definitions = selectedAssessment ? [...schoolYears].sort().reverse().map((year) => ({
    year, assessment: assessmentForYear(selectedAssessment, year)
  })) : [];
  const cohort = dashboardCohort(rows, placements, schoolYears, classroomGroups, filters);
  const options = dashboardFilterOptions(definitions, fieldKeys, roundId);
  const byStudent = filters.chartType === "progression" && filters.studentIds.length > 0;
  const observations = dashboardObservations(definitions, cohort, options.selectedFieldKeys, sectionIds, roundId, scaleCodesForField, byStudent);
  return { cohort, options, selectedAssessment, observations };
}

export function dashboardChartView(observations: ReturnType<typeof dashboardObservations>,
  { chartType, years }: Pick<DashboardFilters, "chartType" | "years">) {
  const { selectedYears, chartData, series: chartSeries, scaleCodes } = dashboardChartSelection(observations, years);
  const pieData = chartType !== "average" ? [] : chartSeries.flatMap(({ id, label, field }) => {
    const values = chartData.map((point) => point[id]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const value = averageDashboardValues(values, field.dataType);
    return value !== null && value >= 0 ? [{ name: label, value }] : [];
  });
  const title = chartType === "progression" ? (observations.byStudent ? "Student scores by year and window" : "Average field score by year and window")
    : chartType === "comparison" ? "Field comparison by year and window" : "Average selected field values";
  return { selectedYears, plot: { chartType, title, chartData, chartSeries, pieData, scaleCodes } };
}

export function savedReportChartPlots(context: ChartContext,
  charts: ReadonlyArray<{ id: string; name: string; filters: DashboardFilters }>) {
  return charts.map(({ id, name, filters }) => {
    const { observations } = dashboardChartSource(context, filters);
    return { id, ...dashboardChartView(observations, filters).plot, title: name };
  });
}
