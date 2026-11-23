import type { AssessmentTemplate } from "./assessment-templates";
import { dashboardCohort, dashboardFilterOptions, type DashboardFilters, type DashboardTeam } from "./dashboard-filters";
import type { StudentPlacement } from "./overview-state";
import type { OrfResultRow } from "./sample-results";

type DashboardFavoriteContext = {
  rows: OrfResultRow[];
  placements: StudentPlacement[];
  templates: AssessmentTemplate[];
  schoolYears: string[];
  classroomGroups: readonly DashboardTeam[];
  assessmentForYear: (assessment: AssessmentTemplate, year: string) => AssessmentTemplate;
};

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === "string");
}

function parseDashboardFavorite(value: unknown): DashboardFilters | null {
  if (!value || typeof value !== "object") return null;
  const saved = value as Record<string, unknown>;
  const { chartType, assessmentId, fieldKeys, homerooms, sectionIds, studentKey, teamId, roundId, years } = saved;
  // Accept exactly one shape. A malformed or conflicting selection must not become "All".
  const studentIds = "studentIds" in saved
    ? ("studentKey" in saved ? null : saved.studentIds)
    : studentKey === "all" ? [] : [studentKey];
  if ((chartType !== "progression" && chartType !== "comparison" && chartType !== "average")
    || typeof assessmentId !== "string" || typeof roundId !== "string" || typeof teamId !== "string"
    || !strings(studentIds) || !studentIds.every((id) => id.trim().length > 0)
    || !strings(fieldKeys) || !strings(homerooms) || !strings(sectionIds) || (years !== null && !strings(years))) return null;

  return { chartType, assessmentId, fieldKeys: [...new Set(fieldKeys)], homerooms: [...new Set(homerooms)],
    sectionIds: [...new Set(sectionIds)], studentIds: [...new Set(studentIds)], teamId, roundId, years: years && [...new Set(years)] };
}

type DefinitionContext = Pick<DashboardFavoriteContext, "templates" | "schoolYears" | "assessmentForYear">;

function validChartDefinition({ assessmentId, fieldKeys, roundId, sectionIds }: DashboardFilters,
  { templates, schoolYears, assessmentForYear }: DefinitionContext) {
  const assessment = templates.find((item) => item.id === assessmentId);
  if (!assessment) return false;
  const definitions = [...schoolYears].sort().reverse().map((year) => ({ year, assessment: assessmentForYear(assessment, year) }));
  const options = dashboardFilterOptions(definitions, fieldKeys, roundId);
  return fieldKeys.every((id) => options.fields.some((field) => field.id === id))
    && (roundId === "all" || options.rounds.some((round) => round.id === roundId))
    && sectionIds.every((id) => options.sections.some((section) => section.id === id));
}

export function decodeDashboardFavorite(value: unknown, context: DashboardFavoriteContext, usage: "dashboard" | "report" = "dashboard"): DashboardFilters | null {
  const filters = parseDashboardFavorite(value);
  if (!filters || !validChartDefinition(filters, context)) return null;
  const { teamId, homerooms, studentIds, years } = filters;
  const { rows, placements, schoolYears, classroomGroups } = context;
  if (teamId !== "all" && !classroomGroups.some((group) => group.id === teamId)) return null;
  const cohort = dashboardCohort(rows, placements, schoolYears, classroomGroups, filters);
  const availableStudents = new Set(cohort.students.map((student) => student.id));
  const studentsInScope = studentIds.filter((id) => availableStudents.has(id));
  const roomsInScope = homerooms.filter((room) => cohort.homerooms.includes(room));
  const yearsInScope = years?.filter((year) => schoolYears.includes(year)) ?? null;
  if (usage === "dashboard") {
    return studentsInScope.length === studentIds.length && roomsInScope.length === homerooms.length
      && yearsInScope?.length === years?.length ? filters : null;
  }
  if ((studentIds.length && !studentsInScope.length) || (homerooms.length && !roomsInScope.length)
    || (years?.length && !yearsInScope?.length)) return null;
  return { ...filters, studentIds: studentsInScope, homerooms: roomsInScope, years: yearsInScope };
}
