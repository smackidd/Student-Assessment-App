import { GoogleAuthProvider, signInWithPopup, signOut, type Auth } from "firebase/auth";

export const schoolEmailDomain = "foothillsacademy.org";

export function isSchoolEmail(email: string) {
  return /^[^\s@]+@foothillsacademy\.org$/i.test(email.trim());
}

export async function signInWithSchoolGoogle(auth: Auth) {
  const provider = new GoogleAuthProvider();
  // The hosted-domain parameter guides account selection. The blocking Function
  // enforces the actual invitation, provider and verified email on the server.
  provider.setCustomParameters({ hd: schoolEmailDomain, prompt: "select_account" });
  const credential = await signInWithPopup(auth, provider);
  if (!credential.user.emailVerified || !isSchoolEmail(credential.user.email ?? "")) {
    await signOut(auth);
    throw new Error(`Use your invited ${schoolEmailDomain} Google account.`);
  }
  return credential.user;
}

export function googleSignInError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
    return "Google sign-in was cancelled. Select Sign in with Google to try again.";
  }
  if (code === "auth/popup-blocked") return "Allow pop-ups for this site, then try Google sign-in again.";
  if (code === "auth/operation-not-allowed" || code === "auth/unauthorized-domain") {
    return "Google sign-in is not available on this site yet. Contact your administrator.";
  }
  if (code === "auth/account-exists-with-different-credential") {
    return "This account uses an existing sign-in method. Contact your administrator to arrange Google access.";
  }
  if (code === "auth/network-request-failed") return "Unable to reach Google sign-in. Check your connection and try again.";
  if (code === "auth/user-disabled") return "This account has been disabled. Contact your administrator.";
  if (code === "auth/internal-error" || code === "auth/blocking-function-error") {
    return `Google sign-in could not be completed. Use the exact ${schoolEmailDomain} account your administrator invited, or contact your administrator.`;
  }
  return error instanceof Error ? error.message : "Google sign-in could not be completed. Try again.";
}
