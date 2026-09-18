import { beforeEach, describe, expect, it, vi } from "vitest";

// Firebase is entirely replaced before importing the handlers: these tests
// cannot contact Auth, Firestore, SQL Connect, or the invitation-mail extension.
const fixtures = vi.hoisted(() => {
  class FakeHttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  }
  return {
    FakeHttpsError,
    auth: {
      getUserByEmail: vi.fn(), createUser: vi.fn(), updateUser: vi.fn(),
      setCustomUserClaims: vi.fn(), revokeRefreshTokens: vi.fn(),
      generatePasswordResetLink: vi.fn(), getUser: vi.fn(), listUsers: vi.fn()
    },
    queueMail: vi.fn(),
    initialAdmin: "bootstrap@foothillsacademy.org"
  };
});

vi.mock("../functions/node_modules/firebase-admin/lib/esm/app/index.js", () => ({
  getApps: () => [{}], initializeApp: vi.fn()
}));
vi.mock("../functions/node_modules/firebase-admin/lib/esm/auth/index.js", () => ({
  getAuth: () => fixtures.auth
}));
vi.mock("../functions/node_modules/firebase-admin/lib/esm/data-connect/index.js", () => ({
  getDataConnect: () => ({})
}));
vi.mock("../functions/node_modules/firebase-admin/lib/esm/firestore/index.js", () => ({
  getFirestore: () => ({ collection: () => ({ add: fixtures.queueMail }) }),
  FieldValue: { serverTimestamp: () => "SERVER_TIMESTAMP" },
  Timestamp: {}
}));
vi.mock("../functions/node_modules/firebase-functions/lib/esm/params/index.mjs", () => ({
  defineString: (name: string, options?: { default: string }) => ({
    value: () => name === "INITIAL_ADMIN_EMAIL" ? fixtures.initialAdmin : options?.default
  })
}));
vi.mock("../functions/node_modules/firebase-functions/lib/esm/v2/providers/identity.mjs", () => ({
  beforeUserCreated: (_options: unknown, handler: unknown) => handler,
  beforeUserSignedIn: (_options: unknown, handler: unknown) => handler,
  HttpsError: fixtures.FakeHttpsError
}));
vi.mock("../functions/node_modules/firebase-functions/lib/esm/v2/providers/https.mjs", () => ({
  onCall: (_options: unknown, handler: unknown) => handler,
  HttpsError: fixtures.FakeHttpsError
}));

import * as functions from "../functions/src/index";

// onCall/beforeUserSignedIn wrappers above return the underlying handler.
const invite = functions.inviteUser as unknown as (request: unknown) => Promise<unknown>;
const signIn = functions.blockUninvitedSignIn as unknown as (event: unknown) => unknown;
const create = functions.blockPublicSignUp as unknown as () => unknown;
const initialize = functions.initializeOrganizationAccess as unknown as (request: unknown) => Promise<unknown>;
const listUsers = functions.listOrganizationUsers as unknown as (request: unknown) => Promise<unknown>;

const schoolEmail = "teacher@foothillsacademy.org";
const inviteClaims = {
  organizationId: "student-assessment", role: "teacher_ea",
  authMethod: "google", invitedEmail: schoolEmail
};
const adminToken = {
  uid: "admin-1", email: "legacy@example.com",
  organizationId: "student-assessment", role: "admin",
  firebase: { sign_in_provider: "password" }
};
const pendingUser = {
  uid: "invited-1", email: schoolEmail, displayName: "Teacher",
  metadata: {}, customClaims: {}
};
const inviteRequest = {
  auth: { uid: "admin-1", token: adminToken },
  data: { email: schoolEmail, displayName: "Teacher", role: "teacher_ea" }
};
function googleEvent(overrides: Record<string, unknown> = {}) {
  return {
    eventType: "providers/cloud.auth/eventTypes/user.beforeSignIn:google.com",
    additionalUserInfo: {
      providerId: "google.com", profile: { hd: "foothillsacademy.org", email: schoolEmail }
    },
    data: { email: schoolEmail, emailVerified: true, customClaims: inviteClaims },
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fixtures.auth.getUserByEmail.mockRejectedValue({ code: "auth/user-not-found" });
  fixtures.auth.createUser.mockResolvedValue(pendingUser);
  fixtures.auth.updateUser.mockResolvedValue(pendingUser);
  fixtures.auth.setCustomUserClaims.mockResolvedValue(undefined);
  fixtures.auth.revokeRefreshTokens.mockResolvedValue(undefined);
  fixtures.auth.getUser.mockResolvedValue({ ...pendingUser, customClaims: inviteClaims });
  fixtures.auth.listUsers.mockResolvedValue({ users: [] });
  fixtures.queueMail.mockResolvedValue({ id: "synthetic-mail" });
});

describe("invitation handler", () => {
  it("reserves the normalized school email with no password and queues a Google sign-in link", async () => {
    await invite({ ...inviteRequest, data: { ...inviteRequest.data, email: " Teacher@FoothillsAcademy.org " } });
    expect(fixtures.auth.createUser).toHaveBeenCalledWith({
      email: schoolEmail, displayName: "Teacher", emailVerified: false, disabled: false
    });
    expect(fixtures.auth.setCustomUserClaims).toHaveBeenCalledWith("invited-1", inviteClaims);
    expect(fixtures.auth.revokeRefreshTokens).toHaveBeenCalledWith("invited-1");
    expect(fixtures.auth.generatePasswordResetLink).not.toHaveBeenCalled();
    const mail = fixtures.queueMail.mock.calls[0][0];
    expect(mail.to).toEqual([schoolEmail]);
    expect(mail.message.text).toContain("Sign in with Google");
    expect(mail.message.text).toContain("https://student-assessment-app.vercel.app/?invited=google");
    expect(mail.message.html).toContain(schoolEmail);
    expect(mail.message.html).not.toContain("Set password");
  });

  it.each(["teacher@gmail.com", "teacher@sub.foothillsacademy.org", "teacher@foothillsacademy.org.evil.test"])(
    "rejects %s before account lookup, writes, or email", async (email) => {
      await expect(invite({ ...inviteRequest, data: { ...inviteRequest.data, email } }))
        .rejects.toMatchObject({ code: "invalid-argument" });
      expect(fixtures.auth.getUserByEmail).not.toHaveBeenCalled();
      expect(fixtures.auth.createUser).not.toHaveBeenCalled();
      expect(fixtures.queueMail).not.toHaveBeenCalled();
    }
  );

  it("requires administrator authorization", async () => {
    await expect(invite({ ...inviteRequest, auth: { token: { ...adminToken, role: "teacher_ea" } } }))
      .rejects.toMatchObject({ code: "permission-denied" });
    expect(fixtures.auth.createUser).not.toHaveBeenCalled();
  });

  it("converts a pending password invitation and revokes its refresh tokens", async () => {
    fixtures.auth.getUserByEmail.mockResolvedValue({
      ...pendingUser, customClaims: { organizationId: "student-assessment", role: "teacher_ea" }
    });
    await invite(inviteRequest);
    expect(fixtures.auth.createUser).not.toHaveBeenCalled();
    expect(fixtures.auth.setCustomUserClaims).toHaveBeenCalledWith("invited-1", inviteClaims);
    expect(fixtures.auth.revokeRefreshTokens).toHaveBeenCalledWith("invited-1");
    expect(fixtures.auth.revokeRefreshTokens.mock.invocationCallOrder[0])
      .toBeLessThan(fixtures.queueMail.mock.invocationCallOrder[0]);
  });

  it("leaves active legacy users and other organizations untouched", async () => {
    for (const existing of [
      { ...pendingUser, metadata: { lastSignInTime: "2026-01-01" }, customClaims: { organizationId: "student-assessment" } },
      { ...pendingUser, customClaims: { organizationId: "other-school" } }
    ]) {
      fixtures.auth.getUserByEmail.mockResolvedValue(existing);
      await expect(invite(inviteRequest)).rejects.toMatchObject({ code: "already-exists" });
    }
    expect(fixtures.auth.updateUser).not.toHaveBeenCalled();
    expect(fixtures.auth.setCustomUserClaims).not.toHaveBeenCalled();
    expect(fixtures.queueMail).not.toHaveBeenCalled();
  });
});

describe("blocking functions and callable authorization", () => {
  it("blocks all client account creation, including otherwise-valid school Google accounts", () => {
    expect(create).toThrow("Only an administrator invitation");
  });

  it("accepts the invited school Google account and rejects uninvited school accounts", () => {
    expect(signIn(googleEvent())).toBeUndefined();
    expect(() => signIn(googleEvent({ data: { email: schoolEmail, emailVerified: true, customClaims: {} } })))
      .toThrow("has not invited");
  });

  it("rejects password sign-in even when Google is linked to the account", () => {
    expect(() => signIn(googleEvent({
      eventType: "providers/cloud.auth/eventTypes/user.beforeSignIn:password",
      additionalUserInfo: { providerId: "password" },
      data: { email: schoolEmail, emailVerified: true, customClaims: inviteClaims, providerData: [{ providerId: "google.com" }] }
    }))).toThrow("Sign in with Google");
  });

  it("requires the school-managed Google profile", () => {
    expect(() => signIn(googleEvent({
      additionalUserInfo: { providerId: "google.com", profile: { email: schoolEmail } }
    }))).toThrow("Google Workspace");
  });

  it("cannot use the initial-admin email to bypass Google sign-in or promote an assigned teacher", () => {
    const claims = { ...inviteClaims, invitedEmail: fixtures.initialAdmin };
    const data = { email: fixtures.initialAdmin, emailVerified: true, customClaims: claims };
    expect(() => signIn(googleEvent({ data, eventType: "providers/cloud.auth/eventTypes/user.beforeSignIn:password" })))
      .toThrow("Sign in with Google");
    expect(signIn(googleEvent({
      data,
      additionalUserInfo: { providerId: "google.com", profile: { hd: "foothillsacademy.org", email: fixtures.initialAdmin } }
    }))).toBeUndefined();
  });

  it("enforces current provider on callable access before an existing-role return", async () => {
    const token = {
      ...adminToken, ...inviteClaims, email: schoolEmail, email_verified: true,
      firebase: { sign_in_provider: "password" }
    };
    await expect(initialize({ auth: { token } })).rejects.toMatchObject({ code: "permission-denied" });
    await expect(listUsers({ auth: { token: { ...token, role: "admin" } } }))
      .rejects.toMatchObject({ code: "permission-denied" });
    expect(fixtures.auth.listUsers).not.toHaveBeenCalled();
  });

  it("accepts an invited Google session while leaving existing legacy access available", async () => {
    await expect(initialize({ auth: { token: {
      ...adminToken, ...inviteClaims, email: schoolEmail, email_verified: true,
      firebase: { sign_in_provider: "google.com" }
    } } })).resolves.toEqual({ active: true, role: "teacher_ea" });
    await expect(initialize({ auth: { token: adminToken } }))
      .resolves.toEqual({ active: true, role: "admin" });
  });
});
