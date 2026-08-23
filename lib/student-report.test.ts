import { describe, expect, it } from "vitest";
import type { StudentIdentityOption } from "@/lib/overview-state";
import {
  addReportStudentId,
  matchingReportStudentOptions,
  reconcileReportStudentIds,
  removeReportStudentId
} from "@/lib/student-report";

const studentOptions: StudentIdentityOption[] = [
  {
    id: "student-a",
    name: "Alex Smith",
    detail: "2026-2027, Grade 3, 3A; 2025-2026, Grade 2, 2B"
  },
  {
    id: "student-b",
    name: "Alex Smith",
    detail: "2026-2027, Grade 4, 4A"
  },
  {
    id: "student-c",
    name: "Jordan Lee",
    detail: "2026-2027, Grade 3, 3B"
  }
];

describe("student report selection", () => {
  it("adds a stable student ID once and preserves selection order", () => {
    expect(addReportStudentId(["student-c"], "student-a")).toEqual(["student-c", "student-a"]);
    expect(addReportStudentId(["student-c", "student-a"], "student-a")).toEqual(["student-c", "student-a"]);
  });

  it("removes only the requested student", () => {
    expect(removeReportStudentId(["student-a", "student-b"], "student-a")).toEqual(["student-b"]);
  });

  it("drops stale and duplicate IDs while keeping same-name students distinct", () => {
    expect(
      reconcileReportStudentIds(["student-a", "missing", "student-b", "student-a"], studentOptions)
    ).toEqual(["student-a", "student-b"]);
  });

  it("searches names and placement context while excluding selected students", () => {
    expect(matchingReportStudentOptions(studentOptions, ["student-a"], "alex").map((option) => option.id)).toEqual([
      "student-b"
    ]);
    expect(matchingReportStudentOptions(studentOptions, [], "grade 2").map((option) => option.id)).toEqual([
      "student-a"
    ]);
  });

  it("returns both same-name identities and respects the result limit", () => {
    expect(matchingReportStudentOptions(studentOptions, [], "Alex Smith").map((option) => option.id)).toEqual([
      "student-a",
      "student-b"
    ]);
    expect(matchingReportStudentOptions(studentOptions, [], "", 2)).toHaveLength(2);
  });
});
