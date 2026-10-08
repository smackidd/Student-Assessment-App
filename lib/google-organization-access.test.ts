import { describe, expect, it } from "vitest";
import { hasGoogleOrganizationAccess } from "./google-organization-access";

const member = {
  organizationId: "student-assessment",
  role: "teacher_ea",
  authMethod: "google",
  email: "staff@foothillsacademy.org",
  invitedEmail: "staff@foothillsacademy.org",
  email_verified: true,
  firebase: { sign_in_provider: "google.com" }
};

describe("Google organization session", () => {
  it("accepts a server-authorized school member", () => {
    expect(hasGoogleOrganizationAccess(member)).toBe(true);
  });
  it("accepts a server-authorized exact outside identity", () => {
    expect(hasGoogleOrganizationAccess({ ...member, role: "admin", email: "owner@gmail.com", invitedEmail: "owner@gmail.com" })).toBe(true);
  });
  it.each([
    { authMethod: undefined },
    { firebase: { sign_in_provider: "password" } },
    { firebase: {} },
    { email_verified: false },
    { invitedEmail: "other@foothillsacademy.org" },
    { email: "", invitedEmail: "" },
    { organizationId: "another-school" },
    { role: "student" }
  ])("rejects stale or mismatched membership %j", (changed) => {
    expect(hasGoogleOrganizationAccess({ ...member, ...changed })).toBe(false);
  });
});
