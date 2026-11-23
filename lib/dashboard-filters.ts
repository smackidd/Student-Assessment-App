import { assessmentFieldAppliesToGrade, assessmentSectionAppliesToGrade, assessmentValueKeys, entryValue, sectionsForAssessmentRound } from "./assessment-entry";
import type { AssessmentFieldTemplate, AssessmentRoundTemplate, AssessmentSectionTemplate, AssessmentTemplate } from "./assessment-templates";
import { averageDashboardValues, labelDashboardYears } from "./dashboard-charts";
import type { StudentPlacement } from "./overview-state";
import type { OrfResultRow } from "./sample-results";
import type { ClassroomGroup } from "./classroom-groups";
import { compareHomerooms } from "./homeroom-order";

export type DashboardTeam = ClassroomGroup;

export type DashboardFilters = {
  chartType: "progression" | "comparison" | "average";
  assessmentId: string;
  fieldKeys: string[];
  homerooms: string[];
  sectionIds: string[];
  studentIds: string[];
  teamId: string;
  roundId: string;
  years: string[] | null;
};

export function defaultDashboardFilters(assessment?: AssessmentTemplate): DashboardFilters {
  return {
    chartType: "progression", assessmentId: assessment?.id ?? "", fieldKeys: [],
    homerooms: [], sectionIds: [], studentIds: [], teamId: "all", roundId: "all", years: null
  };
}

export function dashboardCohort(
  rows: OrfResultRow[], placements: StudentPlacement[], schoolYears: string[], teams: readonly ClassroomGroup[],
  { teamId, homerooms, studentIds }: Pick<DashboardFilters, "teamId" | "homerooms" | "studentIds">
) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const grades = teams.find((team) => team.id === teamId)?.grades;
  const eligible = placements.filter((p) => schoolYears.includes(p.schoolYear) && byId.has(p.studentId) &&
    (teamId === "all" || grades?.includes(p.grade)));
  const roomPlacements = eligible.filter((p) => !homerooms.length || homerooms.includes(p.homeroom));
  const students = [...new Set(roomPlacements.map((p) => p.studentId))].map((id) => byId.get(id)!)
    .sort((a, b) => a.student.localeCompare(b.student) || a.id.localeCompare(b.id));
  const requested = new Set(studentIds);
  const seen = new Set<string>();
  const members = roomPlacements.filter((p) => {
    if (requested.size && !requested.has(p.studentId)) return false;
    const key = JSON.stringify([p.studentId, p.schoolYear, p.grade]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { byId, members, students, homerooms: [...new Set(eligible.map((p) => p.homeroom))].filter(Boolean).sort(compareHomerooms) };
}

export function dashboardStudentOptions(students: Pick<OrfResultRow, "id" | "student">[], selected: string[]) {
  const names = new Set<string>();
  const duplicateNames = new Set<string>();
  for (const { student } of students) {
    const name = student.trim().toLowerCase();
    if (names.has(name)) duplicateNames.add(name);
    names.add(name);
  }
  const options = students.map(({ id, student }) => ({
    id, label: duplicateNames.has(student.trim().toLowerCase()) ? `${student} (${id})` : student, searchText: id
  }));
  const available = new Set(students.map(({ id }) => id));
  for (const id of selected) {
    if (!available.has(id)) options.push({ id, label: `Unavailable student (${id})`, searchText: id });
  }
  return options;
}

type Definition = { year: string; assessment: AssessmentTemplate };
type Section = AssessmentSectionTemplate;
type Field = AssessmentFieldTemplate;
function calculationComponent(field: Field) {
  const condition = field.calculationCondition;
  return condition && typeof condition === "object" && "component" in condition && typeof condition.component === "string"
    ? condition.component : undefined;
}
const fieldKey = (assessment: AssessmentTemplate, field: Field) => `${assessment.id}::${field.id}`;
const seriesKey = (key: string, section?: Section) => section ? `${key}::${section.id}` : key;
function sectionsForField(assessment: AssessmentTemplate, round: AssessmentRoundTemplate, field: Field): (Section | undefined)[] {
  if (!field.sectionIds?.length) return [undefined];
  const sections = sectionsForAssessmentRound(assessment, round);
  const selected = sections.filter((s) => field.sectionIds!.includes(s.id));
  return !selected.length && assessment.id === "orf" ? sections : selected;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function dashboardFilterOptions(definitions: Definition[], fieldKeys: string[], roundId: string) {
  const fields = uniqueById(definitions.flatMap(({ assessment }) => assessment.fields.map((field) => ({
    id: fieldKey(assessment, field), label: field.name, field
  }))));
  const selectedFieldKeys = fieldKeys.length ? fieldKeys : fields.slice(0, 1).map((field) => field.id);
  const rounds = uniqueById(definitions.flatMap(({ assessment }) => assessment.rounds));
  const sections = uniqueById(definitions.flatMap(({ assessment }) => assessment.rounds.flatMap((round) => {
    if (roundId !== "all" && roundId !== round.id) return [];
    return assessment.fields.filter((field) => selectedFieldKeys.includes(fieldKey(assessment, field)) &&
      (!field.roundIds?.length || field.roundIds.includes(round.id)))
      .flatMap((field) => sectionsForField(assessment, round, field).filter((s): s is Section => !!s));
  })));
  return { fields, selectedFieldKeys, rounds, sections };
}

type Point = {
  axisKey: string; year: string; window: string; windowLabel: string; section: string;
  sectionLabel: string; sectionLine: number; color: string;
  [key: string]: string | number | null;
};
type Series = { id: string; label: string; field: Field; sectionId?: string };

export function dashboardObservations(
  definitions: Definition[], cohort: ReturnType<typeof dashboardCohort>, selectedFieldKeys: string[],
  sectionIds: string[], roundId: string, getScaleCodes: (field: Field) => string[], byStudent = false
) {
  const series = new Map<string, Series>();
  const seriesByYear = new Map<string, Map<string, Series>>();
  const scalesByYear = new Map<string, Map<string, string[]>>();
  const availableYears = new Set<string>();
  const allPoints: Point[] = [];
  const placementsByYear = new Map<string, StudentPlacement[]>();
  const studentLabels = byStudent
    ? new Map(dashboardStudentOptions(cohort.students, []).map(({ id, label }) => [id, label])) : new Map<string, string>();
  for (const p of cohort.members) {
    const group = placementsByYear.get(p.schoolYear) ?? [];
    group.push(p);
    placementsByYear.set(p.schoolYear, group);
  }
  for (const { year, assessment } of definitions) {
    const yearSeries = new Map<string, Series>();
    const scales = new Map<string, string[]>();
    seriesByYear.set(year, yearSeries);
    scalesByYear.set(year, scales);
    const placements = placementsByYear.get(year) ?? [];
    for (const round of assessment.rounds) {
      if (roundId !== "all" && round.id !== roundId) continue;
      const slots = new Map<string | undefined, Point>();
      function slotFor(section?: Section) {
        let point = slots.get(section?.id);
        if (!point) {
          point = {
            axisKey: JSON.stringify([year, round.id, section?.id ?? null]), year, window: round.label,
            windowLabel: "", section: section?.name ?? "", sectionLabel: section?.name ?? "",
            sectionLine: 0, sectionStart: section ? 1 : 0, sectionStartLabel: section?.name ?? "",
            color: round.color ?? "#101820"
          };
          slots.set(section?.id, point);
        }
        return point;
      }
      for (const field of assessment.fields) {
        const key = fieldKey(assessment, field);
        if (!selectedFieldKeys.includes(key) || (field.roundIds?.length && !field.roundIds.includes(round.id))) continue;
        const codes = getScaleCodes(field);
        for (const section of sectionsForField(assessment, round, field)) {
          if (section && sectionIds.length && !sectionIds.includes(section.id)) continue;
          const id = seriesKey(key, section);
          const point = slotFor(section);
          const metric = section ? `${field.name} / ${section.name}` : field.name;
          function register(seriesId: string, label: string) {
            if (yearSeries.has(seriesId)) return;
            const ref = { id: seriesId, field, sectionId: section?.id, label };
            yearSeries.set(seriesId, ref);
            if (!series.has(seriesId)) series.set(seriesId, ref);
          }
          // A student may have more than one grade placement in a year. Give each
          // student one vote in a window's cohort average, even in that case.
          const scores = new Map<string, { sum: number; count: number }>();
          // Published maximums exist even on a blank roster. Only include them alongside a recorded score.
          const referenceTotal = field.calculationKey === "cc3_component_total" || field.calculationKey === "provincial_numeracy_component_total";
          const component = calculationComponent(field);
          const sourceFields = referenceTotal ? assessment.fields.filter((candidate) => !candidate.isCalculated &&
            (!component || calculationComponent(candidate) === component)) : [];
          const keysByGrade = new Map<string, string[]>();
          for (const p of placements) {
            if (!assessmentFieldAppliesToGrade(field, p.grade) || (section && !assessmentSectionAppliesToGrade(section, p.grade))) continue;
            const bucket = scores.get(p.studentId) ?? { sum: 0, count: 0 };
            scores.set(p.studentId, bucket);
            const row = cohort.byId.get(p.studentId)!;
            const context = { schoolYear: year, grade: p.grade };
            if (referenceTotal) {
              const keys = keysByGrade.get(p.grade) ?? sourceFields.flatMap((source) => assessmentValueKeys(assessment, round, source, section, context));
              keysByGrade.set(p.grade, keys);
              if (!keys.some((k) => typeof row.assessmentValues?.[k] === "number")) continue;
            }
            const raw = entryValue(row, assessment, round, field, section, context);
            let value: number | undefined;
            if (codes.length && raw != null) {
              const index = codes.findIndex((code) => code.toLowerCase() === String(raw).trim().toLowerCase());
              if (index >= 0) value = index + 1;
            } else if (typeof raw === "number" && Number.isFinite(raw)) value = raw;
            if (value !== undefined) {
              bucket.sum += value;
              bucket.count++;
            }
          }
          const values: number[] = [];
          for (const [studentId, { sum, count }] of scores) {
            const value = count ? sum / count : null;
            if (value !== null) values.push(value);
            if (byStudent) {
              const studentKey = JSON.stringify([assessment.id, field.id, section?.id ?? null, studentId]);
              register(studentKey, `${studentLabels.get(studentId)} / ${metric}`);
              point[studentKey] = value;
            }
          }
          if (!byStudent) {
            register(id, metric);
            point[id] = averageDashboardValues(values, field.dataType);
          }
          if (values.length) {
            availableYears.add(year);
            scales.set(JSON.stringify(codes), codes);
          }
        }
      }
      // The timeline follows the scheduled windows and section order even when a cell is blank.
      if (!slots.size) slotFor();
      const sectionOrder = sectionsForAssessmentRound(assessment, round).map((s) => s.id);
      const ordered = [...slots].sort(([a], [b]) =>
        (a === undefined ? -1 : sectionOrder.indexOf(a)) - (b === undefined ? -1 : sectionOrder.indexOf(b)));
      ordered.forEach(([, point], index) => {
        point.windowLabel = index ? "" : round.label.includes("/") ? round.label.split("/").pop()!.trim() : round.month || round.label;
        point.sectionLine = index % 2;
        allPoints.push(point);
      });
    }
  }
  // Definitions are supplied newest first so option labels follow the most recent version.
  allPoints.sort((a, b) => a.year.localeCompare(b.year));
  return { byStudent, series: [...series.values()], seriesByYear, scalesByYear, availableYears: [...availableYears], allPoints };
}

export function dashboardChartSelection(observations: ReturnType<typeof dashboardObservations>, years: string[] | null) {
  const selectedYears = years ?? observations.availableYears;
  const selected = new Set(selectedYears);
  const series = uniqueById([...observations.seriesByYear].flatMap(([year, refs]) => selected.has(year) ? [...refs.values()] : []));
  const scales = new Map([...observations.scalesByYear].flatMap(([year, codes]) => selected.has(year) ? [...codes] : []));
  const scaleCodes = scales.size === 1 ? [...scales.values()][0] : [];
  return { selectedYears, series, scaleCodes, chartData: labelDashboardYears(observations.allPoints.filter((point) => selected.has(point.year))) };
}
