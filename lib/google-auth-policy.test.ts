import { describe, expect, it } from "vitest";
import {
  blockingSignInProvider,
  googleInvitationAccessError,
  googleWorkspaceProfileError,
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
      "teacher@gmail.com",
      "teacher@sub.foothillsacademy.org",
      "teacher@foothillsacademy.org.attacker.example",
      "teacher@notfoothillsacademy.org",
      "teacher@foothillsacademy.org@attacker.example",
      "two names@foothillsacademy.org",
      "@foothillsacademy.org",
      undefined
    ]) expect(isSchoolEmail(email), String(email)).toBe(false);
  });

  it("accepts the invited verified Google email", () => {
    expect(googleInvitationAccessError(invitation, identity)).toBeUndefined();
    expect(googleInvitationAccessError(invitation, {
      ...identity, email: "TEACHER@foothillsacademy.org"
    })).toBeUndefined();
  });

  it.each(["password", "emailLink", "custom", "anonymous", "microsoft.com", undefined])(
    "rejects the current provider %s even for a verified school email",
    (provider) => {
      expect(googleInvitationAccessError(invitation, { ...identity, provider })).toContain("Sign in with Google");
    }
  );

  it.each([
    { emailVerified: false },
    { emailVerified: undefined },
    { emailVerified: "true" },
    { email: "teacher@gmail.com" },
    { email: "teacher@sub.foothillsacademy.org" }
  ])("rejects an unverified or non-school identity %j", (override) => {
    expect(googleInvitationAccessError(invitation, { ...identity, ...override })).toBeDefined();
  });

  it("binds invitation to the exact school email and fails closed without its binding", () => {
    expect(googleInvitationAccessError(invitation, {
      ...identity, email: "another@foothillsacademy.org"
    })).toContain("received the invitation");
    expect(googleInvitationAccessError({ ...invitation, invitedEmail: undefined }, identity)).toBeDefined();
    expect(googleInvitationAccessError({ ...invitation, invitedEmail: "teacher@gmail.com" }, identity)).toBeDefined();
  });

  it("preserves the legacy-account sign-in policy", () => {
    expect(googleInvitationAccessError({ role: "admin" }, {
      email: "existing@example.com", emailVerified: false, provider: "password"
    })).toBeUndefined();
    expect(googleWorkspaceProfileError({ role: "admin" }, undefined)).toBeUndefined();
  });
});

describe("trusted sign-in metadata", () => {
  it("recognizes Firebase's current sign-in event and provider metadata", () => {
    expect(blockingSignInProvider({
      eventType: "providers/cloud.auth/eventTypes/user.beforeSignIn:google.com"
    })).toBe("google.com");
    expect(blockingSignInProvider({
      additionalUserInfo: { providerId: "google.com" }
    })).toBe("google.com");
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
    expect(googleWorkspaceProfileError(invitation, {
      hd: "foothillsacademy.org", email: identity.email
    })).toBeUndefined();
    for (const profile of [
      undefined,
      { email: identity.email },
      { hd: "gmail.com", email: identity.email },
      { hd: "sub.foothillsacademy.org", email: identity.email },
      { hd: "foothillsacademy.org", email: "changed@foothillsacademy.org" },
      { hd: "foothillsacademy.org" }
    ]) expect(googleWorkspaceProfileError(invitation, profile)).toBeDefined();
  });
});
