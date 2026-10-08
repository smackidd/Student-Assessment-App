import { describe, expect, it } from "vitest";
import {
  blockingSignInProvider,
  googleInvitationAccessError,
  googleWorkspaceProfileError,
  isAllowedInvitationEmail,
  isApprovedExternalEmail,
  isSchoolEmail
} from "../functions/src/google-auth-policy";

const invitation = {
  organizationId: "student-assessment",
  role: "teacher_ea",
  authMethod: "google",
  invitedEmail: "teacher@foothillsacademy.org"
};
const identity = {
  email: "teacher@foothillsacademy.org",
  emailVerified: true,
  provider: "google.com"
};

describe("Google invitation policy", () => {
  it("accepts normalized addresses only at the exact school domain", () => {
    expect(isSchoolEmail(" Teacher@FoothillsAcademy.org ")).toBe(true);
    for (const email of [
      "teacher@gmail.com", "teacher@sub.foothillsacademy.org",
      "teacher@foothillsacademy.org.attacker.example", "teacher@notfoothillsacademy.org",
      "teacher@foothillsacademy.org@attacker.example", "two names@foothillsacademy.org",
      "@foothillsacademy.org", undefined
    ]) expect(isSchoolEmail(email), String(email)).toBe(false);
  });

  it("accepts the invited verified Google email", () => {
    expect(googleInvitationAccessError(invitation, identity)).toBeUndefined();
    expect(googleInvitationAccessError(invitation, {
      ...identity, email: "TEACHER@foothillsacademy.org"
    })).toBeUndefined();
  });

  it.each(["password", "emailLink", "custom", "anonymous", "microsoft.com", undefined])(
    "rejects the current provider %s even for a verified school email", (provider) => {
      expect(googleInvitationAccessError(invitation, { ...identity, provider })).toContain("Sign in with Google");
    }
  );

  it.each([
    { emailVerified: false }, { emailVerified: undefined }, { emailVerified: "true" },
    { email: "teacher@gmail.com" }, { email: "teacher@sub.foothillsacademy.org" }
  ])("rejects an unverified or non-school identity %j", (override) => {
    expect(googleInvitationAccessError(invitation, { ...identity, ...override })).toBeDefined();
  });

  it("binds the invitation to the exact email and fails closed without its binding", () => {
    expect(googleInvitationAccessError(invitation, {
      ...identity, email: "another@foothillsacademy.org"
    })).toContain("received the invitation");
    expect(googleInvitationAccessError({ ...invitation, invitedEmail: undefined }, identity)).toBeDefined();
    expect(googleInvitationAccessError({ ...invitation, invitedEmail: "teacher@gmail.com" }, identity)).toBeDefined();
  });

  it("requires the Google migration marker for legacy members", () => {
    for (const authMethod of [undefined, "password", "google.com", true]) {
      const claims = { role: "admin", authMethod };
      expect(googleInvitationAccessError(claims, identity)).toContain("administrator");
      expect(googleWorkspaceProfileError(claims, { hd: "foothillsacademy.org", email: identity.email }))
        .toContain("administrator");
    }
  });
});

describe("one configured outside-email exception", () => {
  const approved = "owner@gmail.com";
  const outsideInvitation = { ...invitation, invitedEmail: approved };
  const outsideIdentity = { ...identity, email: approved };

  it("normalizes one exact address and cannot authorize its whole domain", () => {
    expect(isApprovedExternalEmail(" OWNER@GMAIL.COM ", " owner@gmail.com ")).toBe(true);
    expect(isAllowedInvitationEmail(approved, approved)).toBe(true);
    expect(isAllowedInvitationEmail(identity.email, approved)).toBe(true);
    expect(isAllowedInvitationEmail("another@gmail.com", approved)).toBe(false);
    expect(isAllowedInvitationEmail("owner+alias@gmail.com", approved)).toBe(false);
    expect(isAllowedInvitationEmail("owner@gmail.com.attacker.example", approved)).toBe(false);
  });

  it.each([undefined, "", "*", "*@gmail.com", "gmail.com", "owner@gmail.com,another@gmail.com",
    "owner,other@gmail.com", "owner@gmail.com;another@gmail.com", "owner@gmail.com\nother@gmail.com"])(
    "does not authorize the owner when configuration is %s", (configuration) => {
      expect(isApprovedExternalEmail(approved, configuration)).toBe(false);
      expect(googleInvitationAccessError(outsideInvitation, outsideIdentity, configuration)).toBeDefined();
      expect(googleWorkspaceProfileError(outsideInvitation, { email: approved }, configuration)).toBeDefined();
    }
  );

  it("still requires a verified Google sign-in and exact invitation for the exception", () => {
    expect(googleInvitationAccessError(outsideInvitation, outsideIdentity, approved)).toBeUndefined();
    expect(googleWorkspaceProfileError(outsideInvitation, { email: approved }, approved)).toBeUndefined();
    expect(googleInvitationAccessError(outsideInvitation, { ...outsideIdentity, provider: "password" }, approved))
      .toBeDefined();
    expect(googleInvitationAccessError(outsideInvitation, { ...outsideIdentity, emailVerified: false }, approved))
      .toBeDefined();
    expect(googleInvitationAccessError({ ...outsideInvitation, invitedEmail: "another@gmail.com" }, outsideIdentity, approved))
      .toBeDefined();
    expect(googleWorkspaceProfileError(outsideInvitation, { email: "another@gmail.com" }, approved)).toBeDefined();
  });

  it("accepts a verified managed Workspace exception including an alias email domain", () => {
    const email = "owner@example.org";
    const claims = { ...invitation, invitedEmail: email };
    for (const verification of [{}, { email_verified: true }, { verified_email: true }]) {
      expect(googleWorkspaceProfileError(claims, { email, hd: "primary-workspace.org", ...verification }, email))
        .toBeUndefined();
    }
    expect(googleInvitationAccessError(claims, { ...identity, email }, email)).toBeUndefined();
    for (const profile of [
      { email }, { email, email_verified: true }, { email, hd: "" },
      { email, hd: "https://example.org" }, { email, hd: "example.org", email_verified: "true" },
      { email, hd: "example.org", email_verified: true, verified_email: false }
    ]) expect(googleWorkspaceProfileError(claims, profile, email)).toBeDefined();
  });

  it("fails closed for a third-party mailbox registered as a Google account", () => {
    const email = "owner@outlook.com";
    expect(googleWorkspaceProfileError({ ...invitation, invitedEmail: email }, {
      email, email_verified: true
    }, email)).toContain("Gmail or a verified Google Workspace mailbox");
  });

  it("immediately rejects a formerly-approved exception after configuration changes", () => {
    expect(googleInvitationAccessError(outsideInvitation, outsideIdentity, "new-owner@gmail.com")).toBeDefined();
    expect(googleWorkspaceProfileError(outsideInvitation, { email: approved }, "new-owner@gmail.com")).toBeDefined();
  });
});

describe("trusted sign-in metadata", () => {
  it("recognizes Firebase's current sign-in event and provider metadata", () => {
    expect(blockingSignInProvider({
      eventType: "providers/cloud.auth/eventTypes/user.beforeSignIn:google.com"
    })).toBe("google.com");
    expect(blockingSignInProvider({ additionalUserInfo: { providerId: "google.com" } })).toBe("google.com");
  });

  it("rejects missing or conflicting current provider information", () => {
    expect(blockingSignInProvider({})).toBeUndefined();
    expect(blockingSignInProvider({
      eventType: "providers/cloud.auth/eventTypes/user.beforeSignIn:password",
      additionalUserInfo: { providerId: "google.com" }
    })).toBeUndefined();
    expect(blockingSignInProvider({
      eventType: "providers/cloud.auth/eventTypes/user.beforeSignIn:google.com",
      credential: { providerId: "password" }
    })).toBeUndefined();
  });

  it("requires Google to attest the managed school domain and current invited email", () => {
    expect(googleWorkspaceProfileError(invitation, { hd: "foothillsacademy.org", email: identity.email }))
      .toBeUndefined();
    for (const profile of [
      undefined, { email: identity.email }, { hd: "gmail.com", email: identity.email },
      { hd: "sub.foothillsacademy.org", email: identity.email },
      { hd: "foothillsacademy.org", email: "changed@foothillsacademy.org" }, { hd: "foothillsacademy.org" }
    ]) expect(googleWorkspaceProfileError(invitation, profile)).toBeDefined();
  });
});
