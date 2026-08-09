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
  grade?: unknown;
  homeroom?: unknown;
};

type DeleteUserRequest = {
  uid?: unknown;
};

type RecordAuditEventRequest = {
  id?: unknown;
  eventType?: unknown;
  entityType?: unknown;
  entityLabel?: unknown;
  description?: unknown;
  importLogId?: unknown;
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

    const invitationReturnUrl = new URL(applicationUrl.value());
    invitationReturnUrl.searchParams.set("invited", "1");
    const actionLink = await getAuth().generatePasswordResetLink(email, {
      url: invitationReturnUrl.toString(),
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
    const grade = optionalAssignment(request.data.grade, "grade");
    const homeroom = optionalAssignment(request.data.homeroom, "homeroom");
    if (role === "teacher_ea" && (!grade || !homeroom)) {
      throw new HttpsError(
        "failed-precondition",
        "Teacher / EA access requires both a grade and a home room assignment."
      );
    }
    if (uid === admin.uid) {
      throw new HttpsError("failed-precondition", "Admins cannot change their own role.");
    }

    const user = await getAuth().getUser(uid);
    if (user.customClaims?.organizationId !== organizationId) {
      throw new HttpsError("not-found", "That user is not part of this organization.");
    }

    const { grade: _previousGrade, homeroom: _previousHomeroom, ...existingClaims } = user.customClaims ?? {};
    await getAuth().setCustomUserClaims(uid, {
      ...existingClaims,
      organizationId,
      role,
      ...(role === "teacher_ea" ? { grade, homeroom } : {})
    });
    await getAuth().revokeRefreshTokens(uid);
    await getFirestore()
      .collection("organizations")
      .doc(organizationId)
      .collection("accessChanges")
      .doc(uid)
      .set({
        uid,
        changedBy: admin.uid,
        changedAt: FieldValue.serverTimestamp()
      });
    return { member: organizationMember(await getAuth().getUser(uid)) };
  }
);

export const recordAuditEvent = onCall(
  { region },
  async (request: CallableRequest<RecordAuditEventRequest>) => {
    const authenticatedUser = requireOrganizationMember(request);
    const id = requiredAuditEventId(request.data.id);
    const eventType = requiredLimitedText(request.data.eventType, "event type", 100);
    const entityType = requiredLimitedText(request.data.entityType, "entity type", 100);
    const entityLabel = requiredLimitedText(request.data.entityLabel, "entity", 500);
    const description = requiredLimitedText(request.data.description, "description", 5000);
    const importLogId = optionalLimitedText(request.data.importLogId, "import log", 160);
    const actorUser = await getAuth().getUser(authenticatedUser.uid);
    const actorEmail = actorUser.email ?? normalizeEmail(authenticatedUser.email);
    const actor = actorUser.displayName?.trim()
      || actorEmail.split("@")[0]
      || actorEmail
      || authenticatedUser.uid;
    const auditEvent = getFirestore()
      .collection("organizations")
      .doc(organizationId)
      .collection("auditEvents")
      .doc(id);

    await getFirestore().runTransaction(async (transaction) => {
      const existing = await transaction.get(auditEvent);
      if (existing.exists) {
        if (existing.get("actorUid") !== authenticatedUser.uid) {
          throw new HttpsError("already-exists", "That audit event identifier is already in use.");
        }
        return;
      }

      transaction.set(auditEvent, {
        eventType,
        entityType,
        entityLabel,
        description,
        actor,
        actorUid: authenticatedUser.uid,
        actorEmail,
        createdAt: FieldValue.serverTimestamp(),
        ...(importLogId ? { importLogId } : {})
      });
    });

    const savedEvent = await auditEvent.get();
    return { event: auditEventForClient(savedEvent.id, savedEvent.data()) };
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

function requireOrganizationMember(request: CallableRequest<unknown>) {
  const token = requireSignedIn(request);
  if (token.organizationId !== organizationId || !isOrganizationRole(token.role)) {
    throw new HttpsError("permission-denied", "Active organization access is required.");
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

function requiredLimitedText(value: unknown, label: string, maximumLength: number) {
  const text = requiredText(value, label);
  if (text.length > maximumLength) {
    throw new HttpsError("invalid-argument", `The ${label} is too long.`);
  }
  return text;
}

function optionalLimitedText(value: unknown, label: string, maximumLength: number) {
  if (value === undefined || value === null || value === "") return "";
  return requiredLimitedText(value, label, maximumLength);
}

function requiredAuditEventId(value: unknown) {
  const id = requiredLimitedText(value, "audit event identifier", 160);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new HttpsError("invalid-argument", "The audit event identifier is invalid.");
  }
  return id;
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
    status: user.metadata.lastSignInTime ? ("active" as const) : ("invited" as const),
    grade: claimText(user.customClaims?.grade),
    homeroom: claimText(user.customClaims?.homeroom)
  };
}

function auditEventForClient(id: string, data: Record<string, unknown> | undefined) {
  const createdAt = timestampIso(data?.createdAt);
  if (!createdAt) throw new HttpsError("internal", "The audit event timestamp could not be confirmed.");
  return {
    id,
    eventType: String(data?.eventType ?? ""),
    entityType: String(data?.entityType ?? ""),
    entityLabel: String(data?.entityLabel ?? ""),
    description: String(data?.description ?? ""),
    actor: String(data?.actor ?? ""),
    actorUid: String(data?.actorUid ?? ""),
    actorEmail: String(data?.actorEmail ?? ""),
    createdAt,
    ...(data?.importLogId ? { importLogId: String(data.importLogId) } : {})
  };
}

function timestampIso(value: unknown) {
  if (!value || typeof value !== "object" || !("toDate" in value)) return "";
  const toDate = (value as { toDate?: () => Date }).toDate;
  if (typeof toDate !== "function") return "";
  const date = toDate.call(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function optionalAssignment(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.trim().length > 80) {
    throw new HttpsError("invalid-argument", `Choose a valid ${label}.`);
  }
  return value.trim();
}

function claimText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
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
