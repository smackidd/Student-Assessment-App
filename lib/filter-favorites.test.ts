import { describe, expect, it } from "vitest";
import { changeFavorites, favoriteDocument, favoriteLabels, readFavorites, shareableFilters } from "@/lib/filter-favorites";
import { decodeDashboardFavorite } from "@/lib/dashboard-favorite";
import { defaultDashboardFilters } from "@/lib/dashboard-filters";
import { assessmentTemplates } from "@/lib/assessment-templates";
import { initialOrfRows } from "@/lib/sample-results";
import { decodeReportFavorite } from "@/lib/report-favorite";

const initial = { type: "save" as const, id: "1", name: "  Winter  ", value: { year: "2025" } };

describe("filter favorites", () => {
  it("round-trips, renames, replaces filters, and deletes only the chosen favorite", () => {
    const save = changeFavorites(readFavorites(undefined), initial);
    expect(readFavorites(favoriteDocument(save, initial.id))).toEqual([{ id: "1", name: "Winter", value: { year: "2025" }, revision: 1 }]);
    const next = changeFavorites(save, { ...initial, id: "2", name: "Fall" });
    const changed = changeFavorites(next, { type: "update", revision: 1, id: "1", name: "Spring", value: { year: "2026" } });
    expect(changed.map((item) => item.name)).toEqual(["Spring", "Fall"]);
    expect(changed[0].value).toEqual({ year: "2026" });
    expect(changeFavorites(changed, { type: "delete", id: "1", revision: 2 }).map((item) => item.id)).toEqual(["2"]);
    expect(save[0].name).toBe("Winter");
    expect(() => changeFavorites([], { ...initial, type: "update", revision: 1 })).toThrow(/no longer exists/);
  });

  it("rejects stale updates and deletes instead of overwriting changes from another browser", () => {
    const saved = changeFavorites([], initial);
    const newer = changeFavorites(saved, { type: "update", id: "1", name: "Latest", revision: 1, value: {} });
    expect(() => changeFavorites(newer, { type: "delete", id: "1", revision: 1 })).toThrow(/changed/);
    expect(() => changeFavorites(newer, { ...initial, type: "update", revision: 1 })).toThrow(/changed/);
  });

  it("leaves legacy favorites private and never trusts unknown audiences or received UI IDs", () => {
    const legacy = changeFavorites([], initial);
    expect(readFavorites(favoriteDocument(legacy, "1"))[0]).not.toHaveProperty("audience");
    const published = changeFavorites(legacy, { id: initial.id, type: "share", revision: 1, audience: "admin" });
    expect(published[0].audience).toBe("admin");
    expect(changeFavorites(published, { ...initial, type: "update", revision: 2 })[0].audience).toBe("admin");
    expect(changeFavorites(published, { id: initial.id, type: "share", revision: 2 })[0]).not.toHaveProperty("audience");
    expect(() => changeFavorites(published, { id: initial.id, type: "share", revision: 1 })).toThrow(/changed/);
    expect(() => readFavorites({ version: 1, items: { "1": { ...legacy[0], audience: "everyone" } } })).toThrow();
    expect(() => changeFavorites([], { ...initial, id: "shared:other:1" })).toThrow(/Invalid favorite ID/);
    const labels = favoriteLabels([legacy[0], ...["a", "b"].map((owner) =>
      ({ ...legacy[0], id: "shared:" + owner + ":1", sharedOwner: owner }))]);
    expect([...labels.values()]).toEqual(["Winter", "Winter (shared by a)", "Winter (shared by b)"]);
  });

  it("preserves existing favorites when a name is invalid or duplicated", () => {
    const current = changeFavorites([], initial);
    for (const name of ["", "  ", "a".repeat(81), "WINTER "]) {
      expect(() => changeFavorites(current, { ...initial, id: "new", name })).toThrow();
    }
    expect(() => changeFavorites(current, initial)).toThrow(/exists/);
    expect(current).toHaveLength(1);
  });

  it("rejects damaged or newer-version documents", () => {
    for (const invalid of [null, "text", {}, { version: 2, items: {} }, { version: 1, items: [] },
      { version: 1, items: { wrong: { id: "right", revision: 1, name: "Preset", value: {} } } }]) {
      expect(() => readFavorites(invalid)).toThrow();
    }
  });
});

describe("dashboard favorites", () => {
  const assessment = assessmentTemplates.find((template) => template.sections?.some((section) => section.id === "irregular"))!;
  const context = {
    templates: [assessment], schoolYears: ["2025"], classroomGroups: [{ id: "team-1", name: "Primary", grades: ["3"] }],
    placements: [{ studentId: "s1", schoolYear: "2025", homeroom: "3A", grade: "3" }],
    rows: [{ ...initialOrfRows[0], id: "s1" }], assessmentForYear: () => assessment
  };
  const filters = { ...defaultDashboardFilters(assessment), fieldKeys: [assessment.id + "::score"],
    homerooms: ["3A"], sectionIds: ["regular", "irregular"], studentIds: ["s1"], teamId: "team-1" };
  it("allows only the chart filter schema in a published projection", () => {
    expect(shareableFilters("dashboard", filters)).toBe(true);
    const { studentIds: _students, ...legacy } = filters;
    expect(shareableFilters("dashboard", { ...legacy, studentKey: "all" })).toBe(true);
    for (const extra of [{ studentKey: "all" }, { resultRows: [] }, { scores: [20] }, { fieldKeys: [{ score: 17 }] }]) {
      expect(shareableFilters("dashboard", { ...filters, ...extra })).toBe(false);
    }
  });
  it("preserves chart mode, authorized values and automatic versus manual years", () => {
    for (const years of [null, [], ["2025"]]) {
      const config = { ...filters, chartType: "comparison", years };
      expect(decodeDashboardFavorite({ ...config, scores: [17] }, context)).toEqual(config);
    }
  });
  it("decodes legacy selections and writes only studentIds without changing untouched favorites", () => {
    const { studentIds, ...base } = filters;
    for (const studentKey of ["all", "s1"]) {
      const saved = { ...base, studentKey };
      const decoded = decodeDashboardFavorite(saved, context);
      expect(decoded).toEqual({ ...base, studentIds: studentKey === "all" ? [] : studentIds });
      const first = changeFavorites([], { ...initial, value: saved });
      const both = changeFavorites(first, { ...initial, id: "2", name: "New", value: decoded });
      expect(readFavorites(favoriteDocument(both, "2")).map((f) => f.value)).toEqual([saved, decoded]);
      const updated = changeFavorites(both, { ...initial, type: "update", value: decoded, revision: 1 });
      expect(readFavorites(favoriteDocument(updated, "1")).every((f) => !Object.hasOwn(f.value as object, "studentKey"))).toBe(true);
    }
    for (const invalid of [{}, { studentKey: "" }, { studentKey: "removed" }, { studentIds: ["s1", "removed"] },
      { studentIds: [], studentKey: "s1" }, { studentIds: null, studentKey: "all" }, { studentIds: "s1" },
      { studentIds: ["s1", 0] }, { studentIds: [" "] }]) {
      expect(decodeDashboardFavorite({ ...base, ...invalid }, context)).toBeNull();
    }
    expect(decodeDashboardFavorite({ ...base, studentIds: ["s1", "s1"] }, context)).toEqual(filters);
  });
  it("preserves multiple explicit IDs in order, even if a student is literally keyed all", () => {
    const expanded = { ...context, rows: [...context.rows, { ...context.rows[0], id: "all" }],
      placements: [...context.placements, { ...context.placements[0], studentId: "all" }] };
    for (const studentIds of [["all", "s1"], ["all"], []]) {
      const saved = { ...filters, studentIds };
      expect(decodeDashboardFavorite(saved, expanded)).toEqual(saved);
    }
  });
  it("rejects invalid or inaccessible filters without widening the selected cohort", () => {
    for (const invalid of [{ studentIds: ["removed"] }, { homerooms: ["gone"] }, { years: ["old"] }, { teamId: "missing" },
      { fieldKeys: ["wrong"] }, { sectionIds: ["wrong"] }, { roundId: "unknown" }, { assessmentId: "deleted" }, { chartType: "new" }]) {
      expect(decodeDashboardFavorite({ ...filters, ...invalid }, context)).toBeNull();
    }
  });
});

describe("student report favorites", () => {
  const options = { studentIds: ["s1", "s2"], assessmentIds: ["a1", "a2"], years: ["2025", "2026"] };

  it("preserves the saved selection order, retains only accessible IDs, and omits all extra data", () => {
    const saved = { studentIds: ["s2", "old", "s1", "s2"], assessmentIds: ["a2", "retired"], years: ["2026", "2021"], scores: [1] };
    expect(decodeReportFavorite(saved, options)).toEqual({ studentIds: ["s2", "s1"], assessmentIds: ["a2"], years: ["2026"] });
  });

  it("preserves deliberately empty selections and never substitutes a new selection for an unavailable one", () => {
    const empty = { studentIds: [], assessmentIds: ["a1"], years: [] };
    expect(decodeReportFavorite(empty, options)).toEqual(empty);
    for (const key of ["studentIds", "assessmentIds", "years"]) {
      expect(decodeReportFavorite({ ...options, [key]: ["removed"] }, options)).toBeNull();
      expect(decodeReportFavorite({ ...options, [key]: [4] }, options)).toBeNull();
    }
    expect(decodeReportFavorite(null, options)).toBeNull();
    expect(decodeReportFavorite({}, options)).toBeNull();
  });
});
