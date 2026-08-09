import type { UserRole } from "@/lib/organization-auth";

export const appViews = ["overview", "dashboard", "assessment", "report", "files", "profile"] as const;
export const assessmentPageTabs = ["builder", "entry"] as const;
export const profilePageTabs = ["profile", "password", "audit", "team"] as const;

export type AppView = (typeof appViews)[number];
export type AssessmentPageTab = (typeof assessmentPageTabs)[number];
export type ProfilePageTab = (typeof profilePageTabs)[number];

export type NavigationPreference = {
  version: 1;
  activeView: AppView;
  assessmentPageTab: AssessmentPageTab;
  profilePageTab: ProfilePageTab;
  selectedAssessmentId: string;
};

type NavigationStorage = Pick<Storage, "getItem" | "setItem">;

const navigationStoragePrefix = "student-assessment:navigation:v1:";

export function navigationStorageKey(uid: string) {
  return `${navigationStoragePrefix}${uid}`;
}

export function sanitizeNavigationPreference(
  value: unknown,
  role: UserRole,
  availableAssessmentIds: readonly string[] = []
): NavigationPreference {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const allowedViews: readonly AppView[] = role === "Admin"
    ? appViews
    : ["dashboard", "assessment", "profile"];
  const activeView = isOneOf(candidate.activeView, allowedViews)
    ? candidate.activeView
    : role === "Admin" ? "overview" : "dashboard";
  const assessmentPageTab = role === "Admin" && isOneOf(candidate.assessmentPageTab, assessmentPageTabs)
    ? candidate.assessmentPageTab
    : "entry";
  const allowedProfileTabs: readonly ProfilePageTab[] = role === "Admin"
    ? profilePageTabs
    : ["profile", "password"];
  const profilePageTab = isOneOf(candidate.profilePageTab, allowedProfileTabs)
    ? candidate.profilePageTab
    : "profile";
  const selectedAssessmentId = typeof candidate.selectedAssessmentId === "string"
    && availableAssessmentIds.includes(candidate.selectedAssessmentId)
    ? candidate.selectedAssessmentId
    : availableAssessmentIds[0] ?? "";

  return { version: 1, activeView, assessmentPageTab, profilePageTab, selectedAssessmentId };
}

export function readNavigationPreference(
  uid: string,
  role: UserRole,
  availableAssessmentIds: readonly string[] = [],
  storage?: NavigationStorage
) {
  const availableStorage = storage ?? browserStorage();
  if (!availableStorage) return sanitizeNavigationPreference(null, role, availableAssessmentIds);

  try {
    const saved = availableStorage.getItem(navigationStorageKey(uid));
    return sanitizeNavigationPreference(saved ? JSON.parse(saved) : null, role, availableAssessmentIds);
  } catch {
    return sanitizeNavigationPreference(null, role, availableAssessmentIds);
  }
}

export function writeNavigationPreference(
  uid: string,
  preference: NavigationPreference,
  storage?: NavigationStorage
) {
  const availableStorage = storage ?? browserStorage();
  if (!availableStorage) return false;

  try {
    availableStorage.setItem(navigationStorageKey(uid), JSON.stringify(preference));
    return true;
  } catch {
    return false;
  }
}

function browserStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.includes(value as T);
}
