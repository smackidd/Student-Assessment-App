import { describe, expect, it } from "vitest";
import {
  mergeWorkspaceForAccess,
  scopeWorkspaceForAccess,
  WorkspaceScopeError,
  type WorkspaceAccess,
  type WorkspaceState
} from "../functions/src/workspace-scope";

const allowedWpmKey = "year_2026_2027__grade_3__oral_reading_fluency_orf__fall_fall__passage_1_p1__wpm_wpm";
const calculatedCwpmKey = "year_2026_2027__grade_3__oral_reading_fluency_orf__fall_fall__passage_1_p1__cwpm_cwpm";
const privateKey = "year_2026_2027__grade_3__oral_reading_fluency_orf__fall_fall__passage_1_p1__private_note_private";
const oldYearKey = "year_2025_2026__grade_3__oral_reading_fluency_orf__fall_fall__passage_1_p1__wpm_wpm";

const teacher: WorkspaceAccess = {
  uid: "teacher-1",
  role: "teacher_ea",
  displayName: "Taylor Teacher",
  email: "teacher@example.com",
  grade: "3",
  homeroom: "3A"
};

function workspace(): WorkspaceState {
  return {
    rows: [
      {
        id: "student-a",
        student: "Alex A",
        homeroom: "3A",
        assessmentValues: {
          [allowedWpmKey]: 42,
          [calculatedCwpmKey]: 39,
          [privateKey]: "restricted",
          [oldYearKey]: 31
        },
        septP1Wpm: 31,
        septP1Epm: 2
      },
      {
        id: "student-b",
        student: "Blake B",
        homeroom: "3B",
        assessmentValues: { [allowedWpmKey]: 50 }
      }
    ],
    placements: [
      { studentId: "student-a", schoolYear: "2026-2027", grade: "3", homeroom: "3A" },
      { studentId: "student-a", schoolYear: "2025-2026", grade: "3", homeroom: "3A" },
      { studentId: "student-b", schoolYear: "2026-2027", grade: "3", homeroom: "3B" }
    ],
    templates: [
      {
        id: "orf",
        name: "Oral Reading Fluency",
        gradeScope: "Grades 3-12",
        rounds: [{ id: "fall", label: "Fall" }],
        sections: [{ id: "p1", name: "Passage 1", roundIds: ["fall"] }],
        fields: [
          {
            id: "wpm",
            name: "WPM",
            dataType: "integer",
            isCalculated: false,
            visibility: "evaluators",
            sectionIds: ["p1"]
          },
          {
            id: "cwpm",
            name: "CWPM",
            dataType: "calculated",
            isCalculated: true,
            visibility: "evaluators",
            sectionIds: ["p1"]
          },
          {
            id: "private",
            name: "Private note",
            dataType: "text",
            isCalculated: false,
            visibility: "admin",
            sectionIds: ["p1"]
          }
        ]
      }
    ],
    schoolYears: ["2026-2027", "2025-2026"],
    lockedOverviewYears: ["2026-2027", "2025-2026"],
    pendingStudentSync: true,
    teamMembers: [{ id: "admin" }],
    auditEvents: [{ id: "audit" }],
    importLogs: [{ id: "import" }]
  };
}

describe("workspace evaluator scope", () => {
  it("returns only the current assigned classroom and evaluator-visible values", () => {
    const scoped = scopeWorkspaceForAccess(workspace(), teacher);

    expect(scoped.schoolYears).toEqual(["2026-2027"]);
    expect(scoped.placements).toEqual([
      { studentId: "student-a", schoolYear: "2026-2027", grade: "3", homeroom: "3A" }
    ]);
    expect(scoped.rows.map((row) => row.id)).toEqual(["student-a"]);
    expect(scoped.rows[0].assessmentValues).toEqual({
      [allowedWpmKey]: 42,
      [calculatedCwpmKey]: 39
    });
    expect(scoped.rows[0].septP1Wpm).toBeNull();
    expect(scoped.templates[0].fields.map((field) => field.id)).toEqual(["wpm", "cwpm"]);
    expect(scoped.pendingStudentSync).toBe(false);
    expect(scoped.auditEvents).toEqual([]);
    expect(scoped.importLogs).toEqual([]);
    expect(scoped.userProfile).toEqual({
      name: "Taylor Teacher",
      email: "teacher@example.com",
      grade: "3",
      homeroom: "3A"
    });
  });

  it("merges only writable values while preserving every server-owned record", () => {
    const current = workspace();
    const proposed = scopeWorkspaceForAccess(current, teacher);
    proposed.rows[0].assessmentValues = {
      ...proposed.rows[0].assessmentValues,
      [allowedWpmKey]: 47
    };

    const merged = mergeWorkspaceForAccess(current, proposed, teacher);

    expect(merged.rows[0].assessmentValues?.[allowedWpmKey]).toBe(47);
    expect(merged.rows[0].assessmentValues?.[calculatedCwpmKey]).toBe(39);
    expect(merged.rows[0].assessmentValues?.[privateKey]).toBe("restricted");
    expect(merged.rows[0].assessmentValues?.[oldYearKey]).toBe(31);
    expect(merged.rows[1]).toEqual(current.rows[1]);
    expect(merged.placements).toEqual(current.placements);
    expect(merged.templates).toEqual(current.templates);
  });

  it("rejects roster changes, calculated-field edits, and out-of-scope values", () => {
    const current = workspace();

    const rosterChange = scopeWorkspaceForAccess(current, teacher);
    rosterChange.rows = [];
    expect(() => mergeWorkspaceForAccess(current, rosterChange, teacher)).toThrow(WorkspaceScopeError);

    const calculatedChange = scopeWorkspaceForAccess(current, teacher);
    calculatedChange.rows[0].assessmentValues![calculatedCwpmKey] = 999;
    expect(() => mergeWorkspaceForAccess(current, calculatedChange, teacher)).toThrow(
      "Calculated or restricted assessment values cannot be changed."
    );

    const scopeChange = scopeWorkspaceForAccess(current, teacher);
    scopeChange.rows[0].assessmentValues![oldYearKey] = 99;
    expect(() => mergeWorkspaceForAccess(current, scopeChange, teacher)).toThrow(
      "The save contained an assessment value outside the assigned scope."
    );
  });

  it("denies evaluator access without both assignments", () => {
    expect(() => scopeWorkspaceForAccess(workspace(), { ...teacher, homeroom: "" })).toThrow(
      "Teacher / EA access requires an assigned grade and home room."
    );
  });

  it("keeps Admin reads and writes unfiltered", () => {
    const state = workspace();
    const admin: WorkspaceAccess = {
      uid: "admin",
      role: "admin",
      displayName: "Admin",
      email: "admin@example.com",
      grade: "",
      homeroom: ""
    };
    expect(scopeWorkspaceForAccess(state, admin)).toBe(state);
    expect(mergeWorkspaceForAccess(state, state, admin)).toBe(state);
  });
});
