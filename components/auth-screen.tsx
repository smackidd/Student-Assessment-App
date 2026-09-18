"use client";

import { useState } from "react";
import { getAuth, sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { firebaseApp } from "@/lib/firebase";
import { googleSignInError, schoolEmailDomain, signInWithSchoolGoogle } from "@/lib/google-sign-in";
import type { InvitationSignInMethod } from "@/lib/invitation-handoff";

export function AuthScreen({ invitationSignInMethod }: { invitationSignInMethod: InvitationSignInMethod | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<"google" | "password" | "reset" | null>(null);

  async function signInGoogle() {
    setAction("google");
    setMessage("");
    try {
      await signInWithSchoolGoogle(getAuth(firebaseApp));
    } catch (error) {
      setMessage(googleSignInError(error));
    } finally {
      setAction(null);
    }
  }

  async function signInPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAction("password");
    setMessage("");
    try {
      await signInWithEmailAndPassword(getAuth(firebaseApp), email.trim(), password);
    } catch {
      setMessage("Unable to sign in with that email and password. Newly invited users must use their school Google account.");
    } finally {
      setAction(null);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setMessage("Enter your existing account email address first.");
      return;
    }
    setAction("reset");
    setMessage("");
    try {
      await sendPasswordResetEmail(getAuth(firebaseApp), email.trim());
    } catch {
      // Keep the response identical whether or not this email has an account.
    } finally {
      setMessage("If this account supports password sign-in, you will receive a reset email. Google-only accounts must continue to use Google.");
      setAction(null);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel">
        <div>
          <p className="eyebrow">Student Evaluations</p>
          <h1>Sign in</h1>
          <p>Use your invited {schoolEmailDomain} Google account. An administrator must invite you before you can access the app.</p>
        </div>
        {invitationSignInMethod === "google" ? (
          <div className="auth-message invitation-message">Your invitation is ready. Sign in with the school Google account that received it.</div>
        ) : invitationSignInMethod === "password" ? (
          <div className="auth-message invitation-message">Sign in below with the email and password from your existing invitation. If your administrator reissued it for Google, use your school Google account.</div>
        ) : null}
        <button className="primary-action" disabled={action !== null} onClick={signInGoogle} type="button">
          {action === "google" ? "Opening Google..." : "Sign in with Google"}
        </button>
        {message ? <div className="auth-message" role="status">{message}</div> : null}
        {invitationSignInMethod !== "google" ? (
          <details className="legacy-signin" open={invitationSignInMethod === "password"}>
            <summary>Existing account with a password</summary>
            <p>For accounts set up before Google sign-in was introduced. New invitations require Google.</p>
            <form className="auth-form" onSubmit={signInPassword}>
              <label>
                Email
                <input autoComplete="email" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
              <label>
                Password
                <input autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
              </label>
              <button className="primary-action" disabled={action !== null} type="submit">
                {action === "password" ? "Signing in..." : "Sign in with password"}
              </button>
            </form>
            <button className="auth-switch" disabled={action !== null} onClick={resetPassword} type="button">
              {action === "reset" ? "Sending reset email..." : "Forgot password?"}
            </button>
          </details>
        ) : null}
      </section>
    </main>
  );
}
