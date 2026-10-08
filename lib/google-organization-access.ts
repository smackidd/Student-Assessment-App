export function hasGoogleOrganizationAccess(claims: Record<string, unknown>) {
  const firebase = claims.firebase && typeof claims.firebase === "object"
    ? claims.firebase as Record<string, unknown>
    : {};
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const invitedEmail = typeof claims.invitedEmail === "string" ? claims.invitedEmail.trim().toLowerCase() : "";
  return claims.organizationId === "student-assessment"
    && (claims.role === "admin" || claims.role === "teacher_ea")
    && claims.authMethod === "google"
    && firebase.sign_in_provider === "google.com"
    && claims.email_verified === true
    && email !== ""
    && email === invitedEmail;
}
