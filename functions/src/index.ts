import { randomBytes } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken, type UserRecord } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { defineString } from "firebase-functions/params";
import { beforeUserCreated, beforeUserSignedIn, HttpsError as IdentityHttpsError } from "firebase-functions/v2/identity";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";

if (!getApps().length) initializeApp();

const region = "northamerica-northeast1";
const organizationId = "student-assessment";
const validRoles = ["admin", "teacher_ea"] as const;
const initialAdminEmail = defineString("INITIAL_ADMIN_EMAIL");
const organizationName = defineString("ORGANIZATION_NAME", { default: "Student Evaluations" });
const applicationUrl = defineString("APPLICATION_URL", {
  default: "https://student-assessment-app.vercel.app"
});

type OrganizationRole = (typeof validRoles)[number];

type InviteRequest = {
  email?: unknown;
  displayName?: unknown;
  role?: unknown;
};

type UpdateRoleRequest = {
  uid?: unknown;
  role?: unknown;
};

type DeleteUserRequest = {
  uid?: unknown;
};

export const blockPublicSignUp = beforeUserCreated({ region }, () => {
  throw new IdentityHttpsError(
    "permission-denied",
    "Only an administrator invitation can create an account."
  );
});

export const blockUninvitedSignIn = beforeUserSignedIn({ region }, (event) => {
  const user = event.data;
  const email = normalizeEmail(user?.email);
  const claims = user?.customClaims ?? {};

  if (email && email === normalizeEmail(initialAdminEmail.value())) {
    return {
      customClaims: {
        ...claims,
        organizationId,
        role: "admin"
      }
    };
  }

  if (claims.organizationId !== organizationId || !isOrganizationRole(claims.role)) {
    throw new IdentityHttpsError(
      "permission-denied",
      "An administrator has not invited this account to the organization."
    );
  }

  return;
});

export const initializeOrganizationAccess = onCall({ region }, async (request) => {
  const auth = requireSignedIn(request);
  const existingRole = claimRole(auth);
  if (auth.organizationId === organizationId && existingRole) {
    return { active: true, role: existingRole };
  }

  const email = normalizeEmail(auth.email);
  if (!email || email !== normalizeEmail(initialAdminEmail.value())) {
    return { active: false };
  }

  const hasAdmin = (await organizationUsers()).some((user) => user.customClaims?.role === "admin");
  if (hasAdmin) return { active: false };

  const user = await getAuth().getUser(auth.uid);
  await getAuth().setCustomUserClaims(auth.uid, {
    ...user.customClaims,
    organizationId,
    role: "admin"
  });
  return { active: true, role: "admin" as const };
});

export const inviteUser = onCall(
  { region },
  async (request: CallableRequest<InviteRequest>) => {
    requireAdmin(request);

    const email = requiredEmail(request.data.email);
    const displayName = requiredText(request.data.displayName, "name");
    const role = requiredRole(request.data.role);
    let user: UserRecord;

    try {
      user = await getAuth().getUserByEmail(email);
      const existingOrganization = user.customClaims?.organizationId;
      if (existingOrganization && existingOrganization !== organizationId) {
        throw new HttpsError("already-exists", "That account belongs to another organization.");
      }
      if (user.metadata.lastSignInTime && existingOrganization === organizationId) {
        throw new HttpsError("already-exists", "That user is already active in this organization.");
      }
      user = await getAuth().updateUser(user.uid, { displayName, disabled: false });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (!isAuthUserNotFound(error)) throw new HttpsError("internal", "The user account could not be prepared.");
      user = await getAuth().createUser({
        email,
        displayName,
        emailVerified: false,
        disabled: false,
        password: randomBytes(48).toString("base64url")
      });
    }

    await getAuth().setCustomUserClaims(user.uid, {
      ...user.customClaims,
      organizationId,
      role
    });

    const actionLink = await getAuth().generatePasswordResetLink(email, {
      url: applicationUrl.value(),
      handleCodeInApp: false
    });
    await queueInvitationEmail({ email, displayName, role, actionLink });

    const refreshedUser = await getAuth().getUser(user.uid);
    return { member: organizationMember(refreshedUser) };
  }
);

export const listOrganizationUsers = onCall({ region }, async (request) => {
  requireAdmin(request);
  const members = (await organizationUsers())
    .map(organizationMember)
    .sort((first, second) => first.displayName.localeCompare(second.displayName));
  return { members };
});

export const updateOrganizationUserRole = onCall(
  { region },
  async (request: CallableRequest<UpdateRoleRequest>) => {
    const admin = requireAdmin(request);
    const uid = requiredText(request.data.uid, "user");
    const role = requiredRole(request.data.role);
    if (uid === admin.uid) {
      throw new HttpsError("failed-precondition", "Admins cannot change their own role.");
    }

    const user = await getAuth().getUser(uid);
    if (user.customClaims?.organizationId !== organizationId) {
      throw new HttpsError("not-found", "That user is not part of this organization.");
    }

    await getAuth().setCustomUserClaims(uid, {
      ...user.customClaims,
      organizationId,
      role
    });
    await getAuth().revokeRefreshTokens(uid);
    return { member: organizationMember(await getAuth().getUser(uid)) };
  }
);

export const deleteOrganizationUser = onCall(
  { region },
  async (request: CallableRequest<DeleteUserRequest>) => {
    const admin = requireAdmin(request);
    const uid = requiredText(request.data.uid, "user");
    const members = await organizationUsers();
    const user = members.find((member) => member.uid === uid);

    if (!user) {
      throw new HttpsError("not-found", "That user is not part of this organization.");
    }

    const adminCount = members.filter((member) => member.customClaims?.role === "admin").length;
    if (user.customClaims?.role === "admin" && adminCount <= 1) {
      throw new HttpsError(
        "failed-precondition",
        "The last Admin cannot be deleted. Assign another Admin first."
      );
    }

    const revocation = getFirestore()
      .collection("organizations")
      .doc(organizationId)
      .collection("revocations")
      .doc(uid);

    await revocation.set({
      uid,
      email: user.email ?? "",
      deletedBy: admin.uid,
      revokedAt: FieldValue.serverTimestamp()
    });

    try {
      await getAuth().revokeRefreshTokens(uid);
      await getAuth().deleteUser(uid);
    } catch (error) {
      await revocation.delete();
      console.error("Organization user deletion failed", error);
      throw new HttpsError("internal", "The user could not be deleted.");
    }

    return { uid };
  }
);

function requireSignedIn(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in is required.");
  return request.auth.token;
}

function requireAdmin(request: CallableRequest<unknown>) {
  const token = requireSignedIn(request);
  if (token.organizationId !== organizationId || token.role !== "admin") {
    throw new HttpsError("permission-denied", "Only an Admin can manage organization users.");
  }
  return token;
}

function claimRole(token: DecodedIdToken) {
  return isOrganizationRole(token.role) ? token.role : null;
}

function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === "string" && validRoles.includes(value as OrganizationRole);
}

function requiredRole(value: unknown) {
  if (!isOrganizationRole(value)) {
    throw new HttpsError("invalid-argument", "Choose Admin or Teacher / EA.");
  }
  return value;
}

function requiredEmail(value: unknown) {
  const email = normalizeEmail(value);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "Enter a valid email address.");
  }
  return email;
}

function requiredText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpsError("invalid-argument", `Enter a ${label}.`);
  }
  return value.trim();
}

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isAuthUserNotFound(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "auth/user-not-found"
  );
}

async function organizationUsers() {
  const users: UserRecord[] = [];
  let pageToken: string | undefined;

  do {
    const page = await getAuth().listUsers(1000, pageToken);
    users.push(
      ...page.users.filter((user) => user.customClaims?.organizationId === organizationId)
    );
    pageToken = page.pageToken;
  } while (pageToken);

  return users;
}

function organizationMember(user: UserRecord) {
  const role = isOrganizationRole(user.customClaims?.role)
    ? user.customClaims.role
    : ("teacher_ea" as const);
  return {
    uid: user.uid,
    displayName: user.displayName ?? user.email?.split("@")[0] ?? "Team member",
    email: user.email ?? "",
    role,
    status: user.metadata.lastSignInTime ? ("active" as const) : ("invited" as const)
  };
}

async function queueInvitationEmail(input: {
  email: string;
  displayName: string;
  role: OrganizationRole;
  actionLink: string;
}) {
  try {
    await getFirestore().collection("mail").add({
      to: [input.email],
      message: {
        subject: `You're invited to ${organizationName.value()}`,
        text: [
          `Hello ${input.displayName},`,
          "",
          `An Admin invited you to ${organizationName.value()} as ${roleLabel(input.role)}.`,
          "Use the secure link below to set your password. The link is single-use and expires automatically.",
          "",
          input.actionLink,
          "",
          "If you were not expecting this invitation, you can ignore this email."
        ].join("\n"),
        html: invitationHtml(input)
      },
      invite: {
        organizationId,
        role: input.role
      },
      createdAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error("Invitation email queue failed", error);
    throw new HttpsError("internal", "The invitation account was created, but the email could not be queued.");
  }
}

function invitationHtml(input: {
  displayName: string;
  role: OrganizationRole;
  actionLink: string;
}) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111923">
      <h1 style="font-size:28px">${escapeHtml(organizationName.value())}</h1>
      <p>Hello ${escapeHtml(input.displayName)},</p>
      <p>An Admin invited you as <strong>${escapeHtml(roleLabel(input.role))}</strong>.</p>
      <p>Set your password using the secure, single-use link below:</p>
      <p style="margin:28px 0">
        <a href="${escapeHtml(input.actionLink)}" style="background:#111923;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;font-weight:700">
          Set password
        </a>
      </p>
      <p style="font-size:13px;color:#5f6874">If you were not expecting this invitation, you can ignore this email.</p>
    </div>
  `;
}

function roleLabel(role: OrganizationRole) {
  return role === "admin" ? "Admin" : "Teacher / EA";
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character] ?? character
  );
}
