"use client";

import { useState } from "react";
import { getAuth } from "firebase/auth";
import { firebaseApp } from "@/lib/firebase";
import { googleSignInError, signInWithOrganizationGoogle } from "@/lib/google-sign-in";
import type { InvitationSignInMethod } from "@/lib/invitation-handoff";

export function AuthScreen({ invitationSignInMethod }: { invitationSignInMethod: InvitationSignInMethod | null }) {
  const [message, setMessage] = useState("");
  const [openingGoogle, setOpeningGoogle] = useState(false);

  async function signInGoogle() {
    setOpeningGoogle(true);
    setMessage("");
    try {
      await signInWithOrganizationGoogle(getAuth(firebaseApp));
    } catch (error) {
      setMessage(googleSignInError(error));
    } finally {
      setOpeningGoogle(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card panel">
        <div>
          <p className="eyebrow">Student Evaluations</p>
          <h1>Sign in</h1>
          <p>Use your invited Google account. Foothills staff must use their foothillsacademy.org account.</p>
        </div>
        {invitationSignInMethod ? (
          <div className="auth-message invitation-message">
            Your invitation is ready. Sign in with Google using the exact email address that received it.
          </div>
        ) : null}
        <button className="primary-action" disabled={openingGoogle} onClick={signInGoogle} type="button">
          {openingGoogle ? "Opening Google..." : "Sign in with Google"}
        </button>
        {message ? <div className="auth-message" role="status">{message}</div> : null}
        <p>An administrator must invite you before you can access the app.</p>
      </section>
    </main>
  );
}
