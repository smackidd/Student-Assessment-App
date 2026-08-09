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
      version: 1 as const,
      activeView: "files" as const,
      assessmentPageTab: "builder" as const,
      profilePageTab: "audit" as const,
      selectedAssessmentId: "orf"
    };

    expect(writeNavigationPreference("admin-a", preference, storage)).toBe(true);
    expect(readNavigationPreference("admin-a", "Admin", ["orf"], storage)).toEqual(preference);
    expect(readNavigationPreference("admin-b", "Admin", ["orf"], storage).activeView).toBe("overview");
    expect(navigationStorageKey("admin-a")).toBe("student-assessment:navigation:v1:admin-a");
    expect(navigationStorageKey("admin-a")).not.toBe(navigationStorageKey("admin-b"));
  });

  it("removes Admin-only tabs when a Teacher or EA signs in", () => {
    expect(sanitizeNavigationPreference({
      activeView: "report",
      assessmentPageTab: "builder",
      profilePageTab: "team",
      selectedAssessmentId: "quick-write"
    }, "Teacher / EA", ["orf", "quick-write"])).toEqual({
      version: 1,
      activeView: "dashboard",
      assessmentPageTab: "entry",
      profilePageTab: "profile",
      selectedAssessmentId: "quick-write"
    });
  });

  it("falls back safely when stored JSON is invalid", () => {
    const storage = {
      getItem: () => "not-json",
      setItem: () => undefined
    };
    expect(readNavigationPreference("teacher", "Teacher / EA", ["orf"], storage)).toEqual({
      version: 1,
      activeView: "dashboard",
      assessmentPageTab: "entry",
      profilePageTab: "profile",
      selectedAssessmentId: "orf"
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

    expect(readNavigationPreference("teacher", "Teacher / EA", ["orf"], blockedStorage).activeView).toBe("dashboard");
    expect(writeNavigationPreference("teacher", {
      version: 1,
      activeView: "dashboard",
      assessmentPageTab: "entry",
      profilePageTab: "profile",
      selectedAssessmentId: "orf"
    }, blockedStorage)).toBe(false);
  });
});
