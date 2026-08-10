# Multi-factor authentication workflow

## Status and decision gate

Decision recorded August 10, 2026: keep the current no-email-verification beta policy and defer Firebase MFA until after beta. APP-095 is post-beta work; do not enable TOTP or change authentication billing/configuration during beta.

After beta, reopen this decision gate before implementation. The current recommended direction is verified email for invited users, authenticator-app TOTP mandatory for Admins, optional staff enrollment during rollout, and two separately controlled Admin recovery accounts.

Firebase's supported TOTP workflow requires all of the following:

- Firebase Authentication with Identity Platform.
- TOTP enabled in the Firebase project configuration.
- A verified primary email address before a user can enroll a second factor.
- Enrollment, sign-in challenge, unenrollment, and recovery UI in the application.

The current beta policy intentionally does not require email verification. That conflicts with Firebase's MFA prerequisite. The product owner selected option 2 for beta:

1. Require verified email and offer TOTP to every account, with TOTP mandatory for Admins.
2. **Selected for beta:** Keep the no-verification beta policy and defer Firebase MFA until after beta.
3. Move staff sign-in to verified Google Workspace accounts, then require TOTP or Workspace MFA for privileged access.

Do not silently switch on MFA. Enabling Identity Platform or changing its configuration can affect billing and sign-in behavior.

## Recommended production workflow

Use TOTP through an authenticator app. It avoids SMS delivery dependencies and phone-number collection.

### Enrollment

1. The signed-in user opens **Profile > Security**.
2. The app requires a recent password reauthentication.
3. The app obtains a Firebase multi-factor session and generates a TOTP secret.
4. The app shows both a QR code and the manual secret. The secret is never saved by the application.
5. The user enters the current six-digit authenticator code.
6. Firebase enrolls the factor with a recognizable display name.
7. The app refreshes the ID token and records a server-authenticated audit event without recording the secret or code.

For Admin accounts, privileged screens remain unavailable until at least one factor is enrolled once the enforcement policy is activated.

### Sign-in challenge

1. Email and password are verified normally.
2. If Firebase returns `auth/multi-factor-auth-required`, the app retains the `MultiFactorResolver` only in component memory.
3. The user selects an enrolled TOTP factor and enters the current code.
4. The resolver completes sign-in. Invalid or expired codes keep the user on the challenge without disclosing account details.
5. Cancelling clears the resolver and password from memory.

### Unenrollment

1. The user opens **Profile > Security** and chooses a factor.
2. The app requires recent reauthentication.
3. The user confirms removal.
4. Firebase unenrolls the factor and the app records a server-authenticated audit event.
5. The last Admin factor cannot be removed while Admin MFA enforcement is active.

### Recovery

- A user who still has another enrolled factor signs in with it and removes the unavailable factor.
- If all factors are unavailable, a separate Admin verifies the staff member through the school's approved offline process.
- The Admin removes the factor through Firebase user administration, revokes refresh tokens, and records a reason in the audit log.
- An Admin must never reset their own factor through the in-app recovery path.
- With only one Admin, the school must retain a documented break-glass procedure owned outside the application.

## Implementation acceptance tests

- Enroll TOTP after recent reauthentication and verify that no secret or code reaches logs, Firestore, SQL, analytics, or browser storage.
- Complete sign-in with a correct code; reject incorrect and expired codes without losing the resolver.
- Cancel a challenge and confirm that the password and resolver are cleared.
- Unenroll one of multiple factors and handle Firebase's token-expired response.
- Prevent an enforced Admin from accessing privileged screens without an enrolled factor.
- Exercise recovery with two Admin accounts and verify token revocation and audit attribution.
- Confirm that invited users who have not verified email receive a clear policy message before enrollment is attempted.

## Enablement checklist

After the email-verification and billing decision is approved:

1. Verify the live Identity Platform plan and authorized domains.
2. Enable TOTP with a documented adjacent-interval setting.
3. Deploy enrollment and challenge UI behind a feature flag.
4. Enroll two break-glass Admin accounts first.
5. Roll out optional staff enrollment.
6. Enforce Admin MFA only after recovery has been tested end to end.

Official implementation reference: <https://firebase.google.com/docs/auth/web/totp-mfa>
