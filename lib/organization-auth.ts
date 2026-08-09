import { getFunctions, httpsCallable } from "firebase/functions";
import { doc, getFirestore, onSnapshot } from "firebase/firestore";
import type { User } from "firebase/auth";
import { firebaseApp } from "@/lib/firebase";

export const organizationId = "student-assessment";
export const roles = ["Admin", "Teacher / EA"] as const;

export type UserRole = (typeof roles)[number];
export type OrganizationAccess = "checking" | "active" | "uninvited";
export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: "invited" | "active";
};

type RoleClaim = "admin" | "teacher_ea";

type CallableMember = {
  uid: string;
  displayName?: string | null;
  email: string;
  role: RoleClaim;
  status: "invited" | "active";
};

type AccessResult = {
  active: boolean;
  role?: RoleClaim;
};

function organizationFunctions() {
  return getFunctions(
    firebaseApp,
    process.env.NEXT_PUBLIC_FIREBASE_FUNCTIONS_REGION ?? "northamerica-northeast1"
  );
}

export function roleFromClaim(value: unknown): UserRole | null {
  if (value === "admin") return "Admin";
  if (value === "teacher_ea") return "Teacher / EA";
  return null;
}

export function roleToClaim(role: UserRole): RoleClaim {
  return role === "Admin" ? "admin" : "teacher_ea";
}

export async function resolveOrganizationAccess(user: User) {
  let token = await user.getIdTokenResult(true);
  let role = roleFromClaim(token.claims.role);
  let active = token.claims.organizationId === organizationId && role !== null;

  if (!active) {
    const initializeAccess = httpsCallable<Record<string, never>, AccessResult>(
      organizationFunctions(),
      "initializeOrganizationAccess"
    );
    const result = await initializeAccess({});
    if (result.data.active) {
      token = await user.getIdTokenResult(true);
      role = roleFromClaim(token.claims.role);
      active = token.claims.organizationId === organizationId && role !== null;
    }
  }

  return {
    access: active ? ("active" as const) : ("uninvited" as const),
    role
  };
}

export async function listOrganizationMembers() {
  const listUsers = httpsCallable<Record<string, never>, { members: CallableMember[] }>(
    organizationFunctions(),
    "listOrganizationUsers"
  );
  const result = await listUsers({});
  return result.data.members.map(teamMemberFromCallable);
}

export async function inviteOrganizationMember(input: {
  email: string;
  name: string;
  role: UserRole;
}) {
  const inviteUser = httpsCallable<
    { email: string; displayName: string; role: RoleClaim },
    { member: CallableMember }
  >(organizationFunctions(), "inviteUser");
  const result = await inviteUser({
    email: input.email.trim().toLowerCase(),
    displayName: input.name.trim(),
    role: roleToClaim(input.role)
  });
  return teamMemberFromCallable(result.data.member);
}

export async function updateOrganizationMemberRole(uid: string, role: UserRole) {
  const updateRole = httpsCallable<
    { uid: string; role: RoleClaim },
    { member: CallableMember }
  >(organizationFunctions(), "updateOrganizationUserRole");
  const result = await updateRole({ uid, role: roleToClaim(role) });
  return teamMemberFromCallable(result.data.member);
}

export async function deleteOrganizationMember(uid: string) {
  const deleteUser = httpsCallable<{ uid: string }, { uid: string }>(
    organizationFunctions(),
    "deleteOrganizationUser"
  );
  const result = await deleteUser({ uid });
  return result.data.uid;
}

export function watchOrganizationAccessRevocation(uid: string, onRevoked: () => void) {
  const revocation = doc(
    getFirestore(firebaseApp),
    "organizations",
    organizationId,
    "revocations",
    uid
  );
  return onSnapshot(revocation, (snapshot) => {
    if (snapshot.exists()) onRevoked();
  });
}

function teamMemberFromCallable(member: CallableMember): TeamMember {
  return {
    id: member.uid,
    name: member.displayName?.trim() || member.email.split("@")[0],
    email: member.email,
    role: roleFromClaim(member.role) ?? "Teacher / EA",
    status: member.status
  };
}
