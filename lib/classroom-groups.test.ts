import { describe, expect, it } from "vitest";
import { assertGroupUnchanged, classroomGroupInput, resolveClassroomGroup, resolveClassroomGroups } from "./classroom-groups";
import { sanitizeNavigationPreference } from "./navigation-preferences";

describe("organization classroom groups", () => {
  it("provides deterministic grade bands before any writes", () => {
    expect(resolveClassroomGroups([])).toEqual([
      { id: "team-1", name: "Team 1", grades: ["3", "4", "5", "6"] },
      { id: "team-2", name: "Team 2", grades: ["7", "8", "9"] },
      { id: "team-3", name: "Team 3", grades: ["10", "11", "12"] }
    ]);
  });
  it("preserves IDs across edits and does not reseed deleted defaults", () => {
    expect(resolveClassroomGroups([
      { id: "team-1", data: { deleted: true } },
      { id: "team-2", data: { name: "Middle", grades: ["9", "7"] } },
      { id: "team-3", data: { deleted: true } },
      { id: "custom-a", data: { name: "Primary", grades: ["1", "2"] } }
    ])).toEqual([
      { id: "team-2", name: "Middle", grades: ["7", "9"] },
      { id: "custom-a", name: "Primary", grades: ["1", "2"] }
    ]);
    expect(resolveClassroomGroups(["team-1", "team-2", "team-3"].map(id => ({ id, data: { deleted: true } })))).toEqual([]);
  });
  it("validates names and grades", () => {
    expect(classroomGroupInput(" Team A ", ["12", "3"])).toEqual({ name: "Team A", grades: ["3", "12"] });
    for (const grades of [[], ["13"], ["3", "3"], ["K"]]) expect(() => classroomGroupInput("A", grades)).toThrow();
    for (const name of ["  ", "a".repeat(81), "a\nb"]) expect(() => classroomGroupInput(name, ["1"])).toThrow();
  });
  it("rejects stale edits and deletions", () => {
    const base = resolveClassroomGroup("team-1")!;
    expect(() => assertGroupUnchanged(base, { ...base, name: "New" })).toThrow();
    expect(() => assertGroupUnchanged(base, { ...base, grades: ["5"] })).toThrow();
    expect(() => assertGroupUnchanged(base, null)).toThrow();
    expect(() => assertGroupUnchanged(null, base)).toThrow();
    expect(() => assertGroupUnchanged(base, { ...base })).not.toThrow();
  });
  it("restores the management tab only for admins", () => {
    const pref = { activeView: "profile", profilePageTab: "classroom-groups" };
    expect(sanitizeNavigationPreference(pref, "Admin").profilePageTab).toBe("classroom-groups");
    expect(sanitizeNavigationPreference(pref, "Teacher / EA").profilePageTab).toBe("profile");
  });
});
