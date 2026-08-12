import { describe, expect, it } from "vitest";
import { latestSchoolYear, resolveTeamMemberAccess, teamAssignmentHomerooms } from "@/lib/team-assignments";

describe("latestSchoolYear", () => {
  it("uses the newest year even when the saved list is out of order", () => {
    expect(latestSchoolYear(["2025-2026", "2027-2028", "2026-2027"])).toBe("2027-2028");
  });
});

describe("teamAssignmentHomerooms", () => {
  it("lists unique home rooms from only the selected year", () => {
    const placements = [
      { studentId: "a", schoolYear: "2027-2028", grade: "3", homeroom: "3B" },
      { studentId: "b", schoolYear: "2027-2028", grade: "3", homeroom: "3A" },
      { studentId: "c", schoolYear: "2027-2028", grade: "3", homeroom: "3A" },
      { studentId: "d", schoolYear: "2026-2027", grade: "3", homeroom: "3Old" },
      { studentId: "e", schoolYear: "2027-2028", grade: "4", homeroom: "  " }
    ];

    const result = teamAssignmentHomerooms(placements, "2027-2028");

    expect(result["3"]).toEqual(["3A", "3B"]);
    expect(result["4"]).toEqual([]);
    expect(result["5"]).toEqual([]);
  });
});

describe("resolveTeamMemberAccess", () => {
  const member = {
    id: "teacher-1",
    name: "Taylor Teacher",
    email: "teacher@example.com",
    role: "Teacher / EA" as const,
    status: "active" as const,
    grade: "",
    homeroom: ""
  };
  const assignments = { "3": ["3A"], "4": ["4A", "4B"] };

  it("preserves a selected grade while leaving home room optional", () => {
    expect(resolveTeamMemberAccess(member, { grade: "4", homeroom: "" }, assignments)).toEqual({
      role: "Teacher / EA",
      grade: "4",
      homeroom: ""
    });
  });

  it("clears a home room that does not belong to the newly selected grade", () => {
    expect(resolveTeamMemberAccess({ ...member, grade: "3", homeroom: "3A" }, { grade: "4" }, assignments)).toEqual({
      role: "Teacher / EA",
      grade: "4",
      homeroom: ""
    });
  });
});
