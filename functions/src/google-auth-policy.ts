export const invitedEmailDomain = "foothillsacademy.org";
export const googleAuthMethod = "google";

type Claims = Record<string, unknown>;

type SignInIdentity = {
  email?: unknown;
  emailVerified?: unknown;
  provider?: unknown;
};

type BlockingSignInMetadata = {
  eventType?: string;
  additionalUserInfo?: { providerId?: string };
  credential?: { providerId: string };
};

type GoogleProfile = {
  hd?: unknown;
  email?: unknown;
  email_verified?: unknown;
  verified_email?: unknown;
};

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isSchoolEmail(value: unknown): boolean {
  return /^[^\s@]+@foothillsacademy\.org$/.test(normalizeEmail(value));
}

// Server configuration authorizes one exact address, never an outside domain.
// An empty, malformed, or comma-separated value leaves the exception disabled.
export function isApprovedExternalEmail(value: unknown, approvedEmail: unknown): boolean {
  const email = normalizeEmail(value);
  const approved = normalizeEmail(approvedEmail);
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(approved)
    && !isSchoolEmail(approved)
    && email === approved;
}

export function isAllowedInvitationEmail(value: unknown, approvedEmail?: unknown): boolean {
  return isSchoolEmail(value) || isApprovedExternalEmail(value, approvedEmail);
}

// The event metadata describes this sign-in. A user's linked providerData does
// not: a Google-linked account can still attempt a password sign-in.
export function blockingSignInProvider(event: BlockingSignInMetadata): string | undefined {
  const eventProvider = event.eventType?.match(/\.beforeSignIn:([^:]+)$/)?.[1];
  const providers = [
    eventProvider,
    event.additionalUserInfo?.providerId,
    event.credential?.providerId
  ].filter((provider): provider is string => Boolean(provider));
  return providers.length && providers.every((provider) => provider === providers[0])
    ? providers[0]
    : undefined;
}

// Every member must have an administrator-issued identity binding. A migration
// adds these claims to existing allowed members while preserving their UID,
// role, and classroom assignments. Missing claims cannot retain password access.
export function googleInvitationAccessError(
  claims: Claims,
  identity: SignInIdentity,
  approvedEmail?: unknown
): string | undefined {
  if (claims.authMethod !== googleAuthMethod) {
    return "An administrator must enable your invited account for Sign in with Google.";
  }
  if (identity.provider !== "google.com") {
    return "This invitation requires Sign in with Google using the account that received the invitation.";
  }
  if (identity.emailVerified !== true || !isAllowedInvitationEmail(identity.email, approvedEmail)) {
    return "Use your verified, approved Google account.";
  }
  const invitedEmail = normalizeEmail(claims.invitedEmail);
  if (!isAllowedInvitationEmail(invitedEmail, approvedEmail) || invitedEmail !== normalizeEmail(identity.email)) {
    return "Sign in with the Google account that received the invitation.";
  }
  return undefined;
}

export function googleWorkspaceProfileError(
  claims: Claims,
  profile: unknown,
  approvedEmail?: unknown
): string | undefined {
  if (claims.authMethod !== googleAuthMethod) {
    return "An administrator must enable your invited account for Sign in with Google.";
  }
  const googleProfile: GoogleProfile = profile && typeof profile === "object" ? profile : {};
  const invitedEmail = normalizeEmail(claims.invitedEmail);
  if (normalizeEmail(googleProfile.email) !== invitedEmail || !invitedEmail) {
    return "Sign in with the Google account that received the invitation.";
  }
  // This profile is supplied by Firebase from the verified Google response.
  // The browser's hd parameter is only an account-chooser hint and is never used.
  if (isSchoolEmail(invitedEmail)) {
    return googleProfile.hd === invitedEmailDomain
      ? undefined
      : "Use the Google Workspace account managed by foothillsacademy.org.";
  }
  if (!isApprovedExternalEmail(invitedEmail, approvedEmail)) {
    return "This outside account is not approved for the organization.";
  }
  // Google is authoritative for Gmail and verified Google Workspace mailboxes.
  // A Google account registered with another email provider does not prove that
  // the current Google user still controls that mailbox, even if verified once.
  const emailDomain = invitedEmail.split("@")[1];
  if (emailDomain === "gmail.com") return undefined;
  const hostedDomain = typeof googleProfile.hd === "string"
    ? googleProfile.hd.trim().toLowerCase()
    : "";
  // Google userinfo v2 uses verified_email; OpenID Connect uses email_verified.
  const verification = [googleProfile.email_verified, googleProfile.verified_email]
    .filter((value) => value !== undefined);
  // The blocking handler checks the current identity emailVerified === true
  // before validating this trusted provider profile.
  // Profile verification fields are optional and must agree when present.
  // Workspace alias email domains can differ from the managed hosted domain.
  const managedDomain = hostedDomain.length <= 253
    && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostedDomain);
  if (managedDomain && verification.every((value) => value === true)) return undefined;
  return "The approved outside account must use Gmail or a verified Google Workspace mailbox.";
}
