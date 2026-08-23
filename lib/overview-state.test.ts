import { describe, expect, it } from "vitest";
import {
  buildStudentSearchOptions,
  canImportOverviewYear,
  deleteSchoolYearFromOverview,
  moveStudentToExistingHomeroom,
  parseOverviewStudentCount,
  reassignPlaceholderToExistingStudent,
  type StudentPlacement
} from "@/lib/overview-state";
import { hydrateOrfRow, type OrfResultRow } from "@/lib/sample-results";

function student(id: string, name: string, assessmentValues: OrfResultRow["assessmentValues"] = {}) {
  return hydrateOrfRow({
    id,
    student: name,
    homeroom: "3A",
    assessmentValues,
    septP1Wpm: null,
    septP1Epm: null,
    septP2Wpm: null,
    septP2Epm: null,
    septP3Wpm: null,
    septP3Epm: null
  });
}

describe("parseOverviewStudentCount", () => {
  it("accepts whole student counts from 1 through 40", () => {
    expect(parseOverviewStudentCount("1")).toBe(1);
    expect(parseOverviewStudentCount("40")).toBe(40);
  });

  it("rejects empty, decimal, and out-of-range counts", () => {
    expect(parseOverviewStudentCount("")).toBeNull();
    expect(parseOverviewStudentCount("1.5")).toBeNull();
    expect(parseOverviewStudentCount("0")).toBeNull();
    expect(parseOverviewStudentCount("41")).toBeNull();
  });
});

describe("canImportOverviewYear", () => {
  it("allows unlocked years and rejects locked years", () => {
    expect(canImportOverviewYear("2026-2027", ["2025-2026"])).toBe(true);
    expect(canImportOverviewYear("2026-2027", ["2026-2027"])).toBe(false);
  });
});

describe("deleteSchoolYearFromOverview", () => {
  it("removes only the selected year's placements and scoped assessment values", () => {
    const rows = [
      student("a", "Alex", {
        year_2025_2026__grade_3__orf: 40,
        year_2026_2027__grade_4__orf: 55,
        legacy_value: 10
      })
    ];
    const placements: StudentPlacement[] = [
      { studentId: "a", schoolYear: "2025-2026", grade: "3", homeroom: "3A" },
      { studentId: "a", schoolYear: "2026-2027", grade: "4", homeroom: "4A" }
    ];

    const result = deleteSchoolYearFromOverview({
      rows,
      placements,
      schoolYears: ["2026-2027", "2025-2026"],
      lockedYears: [],
      selectedYear: "2025-2026",
      yearToDelete: "2025-2026"
    });

    expect(result.status).toBe("deleted");
    if (result.status !== "deleted") return;
    expect(result.selectedYear).toBe("2026-2027");
    expect(result.placements).toEqual([{ studentId: "a", schoolYear: "2026-2027", grade: "4", homeroom: "4A" }]);
    expect(result.rows[0].assessmentValues).toEqual({ year_2026_2027__grade_4__orf: 55, legacy_value: 10 });
  });

  it("blocks locked and last remaining years", () => {
    const input = { rows: [], placements: [], selectedYear: "2026-2027", yearToDelete: "2026-2027" };
    expect(deleteSchoolYearFromOverview({ ...input, schoolYears: ["2026-2027", "2025-2026"], lockedYears: ["2026-2027"] })).toEqual({ status: "blocked", reason: "locked" });
    expect(deleteSchoolYearFromOverview({ ...input, schoolYears: ["2026-2027"], lockedYears: [] })).toEqual({ status: "blocked", reason: "last-year" });
  });
});

describe("moveStudentToExistingHomeroom", () => {
  const placements: StudentPlacement[] = [
    { studentId: "a", schoolYear: "2026-2027", grade: "3", homeroom: "3A" },
    { studentId: "b", schoolYear: "2026-2027", grade: "3", homeroom: "3B" }
  ];

  it("moves a student only to a room already present in the selected cohort", () => {
    const result = moveStudentToExistingHomeroom({ placements, studentId: "a", schoolYear: "2026-2027", grade: "3", homeroom: "3B" });
    expect(result.status).toBe("moved");
    if (result.status === "moved") expect(result.placements[0].homeroom).toBe("3B");
  });

  it("blocks custom or unchanged rooms", () => {
    expect(moveStudentToExistingHomeroom({ placements, studentId: "a", schoolYear: "2026-2027", grade: "3", homeroom: "3Z" })).toEqual({ status: "blocked", reason: "missing-homeroom" });
    expect(moveStudentToExistingHomeroom({ placements, studentId: "a", schoolYear: "2026-2027", grade: "3", homeroom: "3A" })).toEqual({ status: "blocked", reason: "same-homeroom" });
  });
});

describe("reassignPlaceholderToExistingStudent", () => {
  it("reuses the stable student ID and preserves historical assessment values", () => {
    const existing = student("existing", "Alex Smith", { year_2026_2027__grade_3__orf: 72 });
    const placeholder = student("placeholder", "New Student 1");
    const result = reassignPlaceholderToExistingStudent({
      rows: [existing, placeholder],
      placements: [{ studentId: "placeholder", schoolYear: "2026-2027", grade: "3", homeroom: "3B" }],
      placeholderId: "placeholder",
      existingStudentId: "existing",
      schoolYear: "2026-2027",
      grade: "3"
    });

    expect(result.status).toBe("reassigned");
    if (result.status !== "reassigned") return;
    expect(result.rows).toEqual([existing]);
    expect(result.placements[0].studentId).toBe("existing");
    expect(result.rows[0].assessmentValues?.year_2026_2027__grade_3__orf).toBe(72);
  });

  it("does not assign the same student twice in one school year", () => {
    const result = reassignPlaceholderToExistingStudent({
      rows: [student("existing", "Alex Smith"), student("placeholder", "New Student 1")],
      placements: [
        { studentId: "existing", schoolYear: "2026-2027", grade: "4", homeroom: "4A" },
        { studentId: "placeholder", schoolYear: "2026-2027", grade: "3", homeroom: "3B" }
      ],
      placeholderId: "placeholder",
      existingStudentId: "existing",
      schoolYear: "2026-2027",
      grade: "3"
    });
    expect(result).toEqual({ status: "blocked", reason: "already-placed" });
  });
});

describe("buildStudentSearchOptions", () => {
  it("keeps same-name placements distinct with year and grade context", () => {
    const options = buildStudentSearchOptions(
      [student("a", "Sam Lee"), student("b", "Sam Lee")],
      [
        { studentId: "a", schoolYear: "2026-2027", grade: "3", homeroom: "3A" },
        { studentId: "b", schoolYear: "2025-2026", grade: "4", homeroom: "4B" }
      ]
    );
    expect(options).toHaveLength(2);
    expect(new Set(options.map((option) => option.key)).size).toBe(2);
    expect(options.map((option) => option.label)).toEqual(expect.arrayContaining([
      "Sam Lee - 2026-2027, Grade 3, 3A",
      "Sam Lee - 2025-2026, Grade 4, 4B"
    ]));
  });
});
