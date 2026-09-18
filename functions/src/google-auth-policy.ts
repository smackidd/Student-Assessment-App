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
};

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function isSchoolEmail(value: unknown): boolean {
  return /^[^\s@]+@foothillsacademy\.org$/.test(normalizeEmail(value));
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

// Unmarked accounts retain the existing access policy until a separate legacy
// migration is approved. New and reissued invitations always receive a marker.
export function googleInvitationAccessError(
  claims: Claims,
  identity: SignInIdentity
): string | undefined {
  if (claims.authMethod !== googleAuthMethod) return undefined;
  if (identity.provider !== "google.com") {
    return "This invitation requires Sign in with Google using your foothillsacademy.org account.";
  }
  if (identity.emailVerified !== true || !isSchoolEmail(identity.email)) {
    return "Use your verified foothillsacademy.org Google account.";
  }
  const invitedEmail = normalizeEmail(claims.invitedEmail);
  if (!isSchoolEmail(invitedEmail) || invitedEmail !== normalizeEmail(identity.email)) {
    return "Sign in with the foothillsacademy.org Google account that received the invitation.";
  }
  return undefined;
}

export function googleWorkspaceProfileError(
  claims: Claims,
  profile: unknown
): string | undefined {
  if (claims.authMethod !== googleAuthMethod) return undefined;
  const googleProfile: GoogleProfile = profile && typeof profile === "object" ? profile : {};
  // This profile is supplied by Firebase from the verified Google response.
  // The browser's hd parameter is only an account-chooser hint and is never used.
  if (googleProfile.hd !== invitedEmailDomain) {
    return "Use the Google Workspace account managed by foothillsacademy.org.";
  }
  if (normalizeEmail(googleProfile.email) !== normalizeEmail(claims.invitedEmail)) {
    return "Sign in with the foothillsacademy.org Google account that received the invitation.";
  }
  return undefined;
}
