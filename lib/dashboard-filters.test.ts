import { describe, expect, it } from "vitest";
import { savedReportChartPlots } from "./dashboard-chart-model";
import { assessmentValueKey } from "./assessment-entry";
import { assessmentTemplates, type AssessmentTemplate } from "./assessment-templates";
import { dashboardChartSelection, dashboardCohort, dashboardFilterOptions, dashboardObservations, dashboardStudentOptions, defaultDashboardFilters } from "./dashboard-filters";
import { initialOrfRows, type OrfResultRow } from "./sample-results";
import type { StudentPlacement } from "./overview-state";

const cc3 = assessmentTemplates.find((a) => a.sections?.some((s) => s.id === "irregular"))!;
const [current, previous, empty] = ["2025-2026", "2024-2025", "2023-2024"];
const years = [current, previous, empty];
const older: AssessmentTemplate = {
  ...cc3, name: "Earlier CC3",
  fields: cc3.fields.map((field) => field.id === "score" ? { ...field, name: "Original score" } : field),
  sections: cc3.sections!.map((section) => section.id === "regular" ? { ...section, name: "Original regular section" } : section)
};
const definitions = years.map((year) => ({ year, assessment: year === previous ? older : cc3 }));
const groups = [{ id: "primary", name: "Primary", grades: ["3", "4"] }];
const score = `${cc3.id}::score`;
const total = `${cc3.id}::total`;
const scope = defaultDashboardFilters(cc3);
const codes = () => [] as string[];
function placement(studentId: string, schoolYear: string, grade: string, homeroom: string): StudentPlacement {
  return { studentId, schoolYear, grade, homeroom };
}
function row(id: string): OrfResultRow {
  return { ...initialOrfRows[0], id, student: "Same display name", assessmentValues: {} };
}
function record(r: OrfResultRow, assessment: AssessmentTemplate, year: string, section: string, grade: string, value: number) {
  const key = assessmentValueKey(assessment, assessment.rounds[0], assessment.fields.find((f) => f.id === "score")!,
    assessment.sections!.find((s) => s.id === section), { schoolYear: year, grade });
  r.assessmentValues![key] = value;
}
function fixture() {
  const [a, b, c] = ["a", "b", "c"].map(row);
  record(a, cc3, current, "regular", "3", 0);
  record(a, cc3, current, "irregular", "3", 17);
  record(b, cc3, current, "regular", "4", 20);
  record(b, older, previous, "regular", "3", 12);
  record(c, cc3, current, "regular", "9", 99);
  const placements = [placement("a", current, "3", "A"), placement("b", current, "4", "B"),
    placement("c", current, "9", "C"), placement("b", previous, "3", "B"), placement("a", empty, "3", "A")];
  return { rows: [a, b, c], placements };
}
describe("dashboard cohort and chart data", () => {
  const chartContext = () => ({ ...fixture(), schoolYears: years, templates: [cc3], classroomGroups: groups,
    assessmentForYear: (_: AssessmentTemplate, year: string) => year === previous ? older : cc3, scaleCodesForField: codes });
  const base = { ...scope, fieldKeys: [score], sectionIds: ["regular", "irregular"], roundId: "fall", teamId: "primary" };

  it("shows a cohort mean per window and section for All students, weighting each student once", () => {
    const context = chartContext();
    record(context.rows[0], cc3, current, "regular", "4", 4);
    context.placements.push(placement("a", current, "4", "B"), context.placements[0]);
    const [plot] = savedReportChartPlots(context, [{ id: "all", name: "All", filters: base }]);
    expect(plot.chartSeries.map(s => s.label)).toEqual(["Score / Regular Words", "Score / Irregular Words"]);
    const points = plot.chartData.filter(p => p.year === current);
    expect(points[0][score + "::regular"]).toBe(11); // ((0 + 4) / 2 + 20) / 2
    expect(points[1][score + "::irregular"]).toBe(17); // no score for b
    expect(plot.chartData.filter(p => p.year === previous)[0][score + "::regular"]).toBe(12);
    expect(plot.chartData.some(p => p.year === empty)).toBe(false);
  });

  it("splits only Progression by selected IDs and keeps real zeros distinct from missing scores", () => {
    const charts = (["progression", "comparison", "average"] as const).map(chartType => ({
      id: chartType, name: chartType, filters: { ...base, chartType, studentIds: ["a", "b", "missing"] }
    }));
    const [line, bar, pie] = savedReportChartPlots(chartContext(), charts);
    const values = Object.fromEntries(line.chartSeries.map(s => [s.label, line.chartData.map(p => p[s.id] ?? null)]));
    expect(values).toEqual({
      "Same display name (a) / Score / Regular Words": [null, null, 0, null],
      "Same display name (b) / Score / Regular Words": [12, null, 20, null],
      "Same display name (a) / Score / Irregular Words": [null, null, null, 17],
      "Same display name (b) / Score / Irregular Words": [null, null, null, null]
    });
    expect(bar.chartSeries).toHaveLength(2);
    expect(bar.chartData.find(p => p.year === current)![score + "::regular"]).toBe(10);
    expect(pie.pieData.map(p => p.value)).toEqual([11, 17]);
  });

  it("keeps a single named student line and never widens an unavailable selection to All", () => {
    const [one, none] = savedReportChartPlots(chartContext(), [["a"], ["c"]].map((studentIds, i) => ({
      id: String(i), name: "Restricted", filters: { ...base, studentIds, sectionIds: ["regular"] }
    })));
    expect(one.chartSeries.map(s => s.label)).toEqual(["Same display name (a) / Score / Regular Words"]);
    expect(one.chartData.map(p => p[one.chartSeries[0].id])).toEqual([0]);
    expect(none.chartSeries).toEqual([]);
    expect(none.chartData).toEqual([]);
  });

  it("plots each student's own scale code at its defined position, keeping an unrecognized code blank", () => {
    const context = chartContext();
    const assessment: AssessmentTemplate = { ...cc3, fields: cc3.fields.map(f => f.id === "score"
      ? { ...f, dataType: "letter", letterRanks: "INS,DEV,PRO" } : f) };
    context.placements = context.placements.map(p => p.studentId === "c" ? { ...p, grade: "3" } : p);
    for (const [studentIndex, value, grade] of [[0, "PRO", "3"], [1, "ins", "4"], [2, "unknown", "3"]] as const) {
      const key = assessmentValueKey(assessment, assessment.rounds[0], assessment.fields.find(f => f.id === "score")!,
        assessment.sections!.find(s => s.id === "regular"), { schoolYear: current, grade });
      context.rows[studentIndex].assessmentValues![key] = value;
    }
    const [plot] = savedReportChartPlots({ ...context, assessmentForYear: () => assessment,
      scaleCodesForField: () => ["INS", "DEV", "PRO"] }, [{ id: "scale", name: "Codes",
      filters: { ...base, teamId: "all", studentIds: ["a", "b", "c"], sectionIds: ["regular"], years: [current] } }]);
    expect(plot.scaleCodes).toEqual(["INS", "DEV", "PRO"]);
    expect(plot.chartSeries.map(s => plot.chartData[0][s.id])).toEqual([3, 1, null]);
  });

  it("keeps zero and missing averages distinct in the shared preview/export model", () => {
    const context = { ...fixture(), schoolYears: years, templates: [cc3], classroomGroups: groups,
      assessmentForYear: () => cc3, scaleCodesForField: codes };
    const filters = { ...scope, chartType: "average" as const, studentIds: ["a"], fieldKeys: [score],
      sectionIds: ["regular"], roundId: "fall", years: [current] };
    const [recorded, missing] = savedReportChartPlots(context, [
      { id: "recorded", name: "Recorded zero", filters },
      { id: "missing", name: "Empty year", filters: { ...filters, years: [empty] } }
    ]);
    expect(recorded.pieData.map(p => p.value)).toEqual([0]);
    expect(missing.pieData).toEqual([]);
  });

  it("lists each home room by number, then letter, independent of roster order", () => {
    const names = ["10B", "9B", "3B", "10A", "4A", "3A", "9A", "3B"];
    const rows = names.map((_, i) => row(String(i)));
    const placements = names.map((name, i) => placement(String(i), current, name.slice(0, -1), name));
    expect(dashboardCohort(rows, placements, years, groups, scope).homerooms)
      .toEqual(["3A", "3B", "4A", "9A", "9B", "10A", "10B"]);
  });

  it("intersects authorized years, row IDs, grades and multiple homerooms; never merges same-name students", () => {
    const { rows, placements } = fixture();
    const cohort = dashboardCohort(rows, [...placements, placements[0], placement("absent", current, "3", "Other")], [current],
      groups, { teamId: "primary", homerooms: ["A", "B"], studentIds: ["b"] });
    expect(cohort.homerooms).toEqual(["A", "B"]);
    expect(cohort.students.map((r) => r.id)).toEqual(["a", "b"]);
    expect(cohort.members).toEqual([placements[1]]);
    expect(dashboardCohort(rows, placements, years, groups, { ...scope, teamId: "deleted" }).members).toEqual([]);
  });

  it("offers every eligible student by ID, distinguishes names, and keeps unavailable selections removable", () => {
    const { rows, placements } = fixture();
    const ids = ["b", "c"];
    const cohort = dashboardCohort(rows, placements, years, groups, { ...scope, studentIds: ids, teamId: "primary" });
    expect(dashboardStudentOptions(cohort.students, ids)).toEqual([
      { id: "a", label: "Same display name (a)", searchText: "a" },
      { id: "b", label: "Same display name (b)", searchText: "b" },
      { id: "c", label: "Unavailable student (c)", searchText: "c" }
    ]);
    expect(cohort.members.map((p) => p.studentId)).toEqual(["b", "b"]);
    expect(dashboardCohort(rows, placements, years, groups, { ...scope, studentIds: ids, homerooms: ["A"] }).members).toEqual([]);
    expect(dashboardCohort(rows, placements, years, groups, { ...scope, studentIds: ["gone"] }).members).toEqual([]);
  });

  it("averages only explicit IDs once per observation, including zero and excluding missing values", () => {
    const { rows, placements } = fixture();
    const other = row("other");
    record(other, cc3, current, "regular", "3", 70);
    function values(studentIds: string[]) {
      const cohort = dashboardCohort([...rows, other], [...placements, placements[0], placement(other.id, current, "3", "A")],
        [current], groups, { ...scope, studentIds });
      const obs = dashboardObservations(definitions, cohort, [score], ["regular", "irregular"], "fall", codes);
      const [regular, irregular] = dashboardChartSelection(obs, [current]).chartData;
      return [regular[score + "::regular"], irregular[score + "::irregular"]];
    }
    expect(values(["b", "a", "a"])).toEqual([10, 17]);
    expect(values(["b", "gone"])).toEqual([20, null]);
    expect(values(["gone"])).toEqual([null, null]);
    expect(values([])).toEqual([30, 17]);
  });

  it("keeps fields and sections distinct, uses each year's definitions, and preserves blank window headers", () => {
    const { rows, placements } = fixture();
    const cohort = dashboardCohort(rows, [...placements, placements[0]], years, groups, { ...scope, homerooms: ["A", "B"] });
    const opts = dashboardFilterOptions(definitions, [score, total], "all");
    const obs = dashboardObservations(definitions, cohort, opts.selectedFieldKeys, ["regular", "irregular"], "all", codes);
    const { selectedYears, chartData } = dashboardChartSelection(obs, null);
    expect(selectedYears).toEqual([current, previous]);
    expect(obs.series.map((s) => s.id)).toEqual([score + "::regular", score + "::irregular", total + "::regular", total + "::irregular"]);
    const [regular, irregular] = chartData.filter((p) => p.year === current && p.window === cc3.rounds[0].label);
    expect(regular[score + "::regular"]).toBe(10);
    expect(irregular[score + "::irregular"]).toBe(17);
    expect(irregular[score + "::regular"]).toBeUndefined();
    expect(irregular.sectionStartLabel).toBe("Irregular Words");
    expect(irregular.sectionStart).toBe(1);
    expect(regular.windowLabel).toBe("Fall");
    expect(irregular.windowLabel).toBe("");
    expect(chartData[0].sectionLabel).toBe("Original regular section");
    expect(chartData[0][score + "::regular"]).toBe(12);
    expect(dashboardChartSelection(obs, [previous]).series[0].label).toBe("Original score / Original regular section");
    expect(chartData.some((p) => p.year === current && p.windowLabel === "Spring" && p[score + "::regular"] === null)).toBe(true);
    expect(dashboardChartSelection(obs, []).chartData).toEqual([]);
    expect(dashboardChartSelection(obs, [empty]).chartData.every((p) => p.year === empty)).toBe(true);
  });

  it("uses historical scale labels for a single year and avoids applying the wrong scale across years", () => {
    const { rows, placements } = fixture();
    const withScale = definitions.map(({ year, assessment }) => ({ year, assessment: { ...assessment,
      fields: assessment.fields.map((field) => ({ ...field, dataType: "letter" as const, letterRanks: year === previous ? "X,Y" : "A,B" }))
    }}));
    for (const { year, assessment } of withScale.slice(0, 2)) {
      const student = year === current ? rows[0] : rows[1];
      const key = assessmentValueKey(assessment, assessment.rounds[0], assessment.fields[0], assessment.sections![0], { schoolYear: year, grade: "3" });
      student.assessmentValues![key] = year === current ? "B" : "Y";
    }
    const obs = dashboardObservations(withScale, dashboardCohort(rows, placements, years, groups, scope),
      [score], ["regular"], "fall", (field) => field.letterRanks!.split(","));
    expect(dashboardChartSelection(obs, [previous]).scaleCodes).toEqual(["X", "Y"]);
    expect(dashboardChartSelection(obs, [previous]).chartData[0][score + "::regular"]).toBe(2);
    expect(dashboardChartSelection(obs, null).scaleCodes).toEqual([]);
  });

  it("counts zero as evidence, not an empty placement, a norm maximum or another student's score", () => {
    const { rows, placements } = fixture();
    const cohort = dashboardCohort(rows, placements, years, groups, { ...scope, studentIds: ["a"] });
    const zeros = dashboardObservations(definitions, cohort, [score], ["regular"], "fall", codes);
    expect(zeros.availableYears).toEqual([current]);
    expect(dashboardChartSelection(zeros, null).chartData[0][score + "::regular"]).toBe(0);
    expect(dashboardObservations(definitions, cohort, [total], ["regular"], "fall", codes).availableYears).toEqual([current]);
    expect(dashboardObservations(definitions, cohort, [total], ["nonword"], "fall", codes).availableYears).toEqual([]);
    expect(dashboardObservations(definitions, cohort, [score], [], "spring", codes).availableYears).toEqual([]);
  });
});
