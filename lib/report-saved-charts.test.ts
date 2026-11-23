import { describe, expect, it } from "vitest";
import { assessmentTemplates } from "./assessment-templates";
import { assessmentValueKey } from "./assessment-entry";
import { decodeDashboardFavorite } from "./dashboard-favorite";
import { dashboardChartSelection, dashboardCohort, dashboardObservations, defaultDashboardFilters } from "./dashboard-filters";
import { reportChartScope, reportChartSelectionIds } from "./report-saved-charts";
import { initialOrfRows } from "./sample-results";

const template = assessmentTemplates.find((a) => a.sections?.some((s) => s.id === "irregular"))!;
const field = template.fields.find((f) => f.id === "score")!;
const section = template.sections!.find((s) => s.id === "regular")!;
const [round] = template.rounds;
const key = template.id + "::score";
const years = ["2025-2026", "2024-2025"];
const rows = ["a", "b", "c", "d"].map((id, i) => ({ ...initialOrfRows[0], id, student: "Same name",
  assessmentValues: Object.fromEntries(years.map((year, j) => [
    assessmentValueKey(template, round, field, section, { schoolYear: year, grade: i === 3 ? "4" : "3" }),
    10 * i + j
  ])) }));
const placements = rows.flatMap((r, i) => years.map((schoolYear) => ({
  studentId: r.id, schoolYear, grade: i === 3 ? "4" : "3", homeroom: i === 2 ? "B" : "A"
})));
const context = { rows, placements, templates: [template], schoolYears: years, assessmentForYear: () => template,
  classroomGroups: [{ id: "grade3", name: "Grade 3", grades: ["3"] }] };
const filters = { ...defaultDashboardFilters(template), fieldKeys: [key], sectionIds: [section.id], roundId: round.id,
  teamId: "grade3", homerooms: ["A"], years: [years[0]] };

function points(value: unknown, studentIds: string[], selectedYears: string[]) {
  const f = decodeDashboardFavorite(value, context, "report")!;
  const scope = reportChartScope(rows, placements, years, studentIds, selectedYears);
  const cohort = dashboardCohort(scope.rows, scope.placements, scope.schoolYears, context.classroomGroups, f);
  const observations = dashboardObservations(scope.schoolYears.map((year) => ({ year, assessment: template })),
    cohort, f.fieldKeys, f.sectionIds, f.roundId, () => []);
  return dashboardChartSelection(observations, f.years).chartData.map((p) => [p.year, p[key + "::regular"]]);
}

describe("Student Report saved charts", () => {
  it("never substitutes another report student for a saved individual, even with the same display name", () => {
    const { studentIds: _, ...legacy } = filters;
    const favorite = { ...legacy, studentKey: "a" };
    expect(points(favorite, ["b"], years)).toEqual([[years[0], null]]);
    expect(points(favorite, ["a", "b"], years)).toEqual([[years[0], 0]]);
  });

  it("intersects saved student IDs with report students before averaging same-name students", () => {
    const saved = { ...filters, studentIds: ["a", "b", "deleted"] };
    expect(decodeDashboardFavorite(saved, context, "report")?.studentIds).toEqual(["a", "b"]);
    expect(points(saved, ["a", "b", "c"], years)).toEqual([[years[0], 5]]);
    expect(points(saved, ["b", "c"], years)).toEqual([[years[0], 10]]);
    expect(points(saved, ["c"], years)).toEqual([[years[0], null]]);
    expect(saved.studentIds).toEqual(["a", "b", "deleted"]);
  });

  it("intersects report years and student IDs with saved rooms, team, fields, sections and window", () => {
    expect(points(filters, ["b", "c", "d"], years)).toEqual([[years[0], 10]]);
    expect(points(filters, ["b"], [years[1]])).toEqual([]);
    expect(points({ ...filters, years: null }, ["b"], [years[1]])).toEqual([[years[1], 11]]);
    expect(points({ ...filters, years: [] }, ["b"], years)).toEqual([]);
    expect(points(filters, [], years)).toEqual([[years[0], null]]);
  });

  it("uses only authorized rows, placements and years even when selection contains stale IDs", () => {
    const scope = reportChartScope([rows[0], rows[1]], [placements[1], placements[4]], [years[0]],
      ["a", "b", "c"], years);
    expect(scope.rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(scope.schoolYears).toEqual([years[0]]);
    expect(scope.placements).toEqual([]);
  });

  it("retains an authorized partial match without mutating the favorite; never widens stale filters", () => {
    const saved = { ...filters, chartType: "average", homerooms: ["Gone", "A"], years: ["Gone", years[0]] };
    const before = structuredClone(saved);
    expect(decodeDashboardFavorite(saved, context, "report")).toEqual({ ...filters, chartType: "average" });
    expect(saved).toEqual(before);
    expect(decodeDashboardFavorite(saved, context)).toBeNull();
    for (const stale of [{ homerooms: ["gone"] }, { years: ["gone"] }, { teamId: "gone" }, { studentIds: ["gone"] },
      { fieldKeys: ["gone"] }, { sectionIds: ["gone"] }, { roundId: "gone" }, { assessmentId: "gone" }]) {
      expect(decodeDashboardFavorite({ ...filters, ...stale }, context, "report")).toBeNull();
    }
  });

  it("restores only IDs in the current private snapshot, not duplicates, garbage or deleted favorites", () => {
    const available = [{ id: "b" }, { id: "a" }];
    expect(reportChartSelectionIds(["a", "b", "a", {}, "old"], available)).toEqual(["b", "a"]);
    expect(reportChartSelectionIds({ id: "b", name: "cached" }, available)).toEqual([]);
    expect(reportChartSelectionIds(["a", "b"], [])).toEqual([]);
  });
});
