import { describe, expect, it } from "vitest";
import {
  navigationStorageKey,
  readNavigationPreference,
  sanitizeNavigationPreference,
  writeNavigationPreference
} from "@/lib/navigation-preferences";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value)
  };
}

describe("navigation preferences", () => {
  it("restores an Admin tab for only the matching UID", () => {
    const storage = memoryStorage();
    const preference = {
      version: 2 as const,
      activeView: "files" as const,
      assessmentPageTab: "builder" as const,
      profilePageTab: "audit" as const,
      selectedAssessmentId: "orf",
      selectedSchoolYear: "2025-2026"
    };

    expect(writeNavigationPreference("admin-a", preference, storage)).toBe(true);
    expect(readNavigationPreference("admin-a", "Admin", ["orf"], ["2026-2027", "2025-2026"], storage)).toEqual(preference);
    expect(readNavigationPreference("admin-b", "Admin", ["orf"], ["2026-2027"], storage).activeView).toBe("overview");
    expect(navigationStorageKey("admin-a")).toBe("student-assessment:navigation:v1:admin-a");
    expect(navigationStorageKey("admin-a")).not.toBe(navigationStorageKey("admin-b"));
  });

  it("removes Admin-only tabs when a Teacher or EA signs in", () => {
    expect(sanitizeNavigationPreference({
      activeView: "report",
      assessmentPageTab: "builder",
      profilePageTab: "team",
      selectedAssessmentId: "quick-write",
      selectedSchoolYear: "2025-2026"
    }, "Teacher / EA", ["orf", "quick-write"], ["2025-2026", "2026-2027"])).toEqual({
      version: 2,
      activeView: "dashboard",
      assessmentPageTab: "entry",
      profilePageTab: "profile",
      selectedAssessmentId: "quick-write",
      selectedSchoolYear: "2026-2027"
    });
  });

  it("migrates legacy preferences and unavailable Admin years to the newest available year", () => {
    const legacy = {
      version: 1,
      activeView: "assessment",
      assessmentPageTab: "entry",
      profilePageTab: "profile",
      selectedAssessmentId: "orf"
    };
    expect(sanitizeNavigationPreference(legacy, "Admin", ["orf"], ["2024-2025", "2026-2027", "2025-2026"]))
      .toMatchObject({ version: 2, selectedSchoolYear: "2026-2027" });
    expect(sanitizeNavigationPreference({ ...legacy, selectedSchoolYear: "2023-2024" }, "Admin", ["orf"], ["2025-2026", "2026-2027"]))
      .toMatchObject({ selectedSchoolYear: "2026-2027" });
  });

  it("falls back safely when stored JSON is invalid", () => {
    const storage = {
      getItem: () => "not-json",
      setItem: () => undefined
    };
    expect(readNavigationPreference("teacher", "Teacher / EA", ["orf"], ["2026-2027"], storage)).toEqual({
      version: 2,
      activeView: "dashboard",
      assessmentPageTab: "entry",
      profilePageTab: "profile",
      selectedAssessmentId: "orf",
      selectedSchoolYear: "2026-2027"
    });
  });

  it("falls back safely when browser storage is unavailable", () => {
    const blockedStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      }
    };

    expect(readNavigationPreference("teacher", "Teacher / EA", ["orf"], ["2026-2027"], blockedStorage).activeView).toBe("dashboard");
    expect(writeNavigationPreference("teacher", {
      version: 2,
      activeView: "dashboard",
      assessmentPageTab: "entry",
      profilePageTab: "profile",
      selectedAssessmentId: "orf",
      selectedSchoolYear: "2026-2027"
    }, blockedStorage)).toBe(false);
  });
});
