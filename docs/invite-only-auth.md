# Invite-only authentication

## Decision

This branch uses a one-time **Set password** link instead of emailing a temporary password.

A temporary password is a reusable secret. It can remain in an inbox, be forwarded, be copied into a ticket, or stay valid if the user never completes the first-login change. A Firebase password action link is single-use, expires automatically, and lets the invited person choose a password that the Admin never sees.

## Roles

- **Admin** can invite users, assign roles, view the organization user list, and change another user's role.
- **Teacher / EA** can sign in to the assessment workspace but cannot invite users or change roles.

Firebase Auth custom claims are the source of truth:

```json
{
  "organizationId": "student-assessment",
  "role": "admin"
}
```

The Teacher / EA claim uses `"role": "teacher_ea"`.

Role values saved in browser state or the prototype workspace JSON are not trusted for authorization.

## Invitation flow

1. An Admin enters a name, email, and role in the Team tab.
2. The `inviteUser` callable Firebase Function verifies the caller's Firebase ID token and Admin claim.
3. The function creates the Firebase Auth user with a cryptographically random unknown password.
4. The function assigns the organization and role custom claims.
5. Firebase generates a one-time password setup link.
6. The function sends the branded invitation through Resend.
7. The invited user sets their password and returns through an invitation handoff URL. The app signs out any account already active in that browser and asks the invited person to sign in with their new credentials.
8. The app reads the signed Firebase ID token and opens only the features allowed by the role.

The `blockPublicSignUp` blocking function rejects client-created accounts. The `blockUninvitedSignIn` blocking function rejects accounts without organization claims.

## Firebase setup

Use the Firebase project `student-assessment-2d869`.

1. In Firebase Authentication, keep Email/Password enabled.
2. Upgrade Authentication to **Firebase Authentication with Identity Platform**. Firebase requires this for blocking functions.
3. Add the production application domain to Authentication's authorized domains.
4. Configure the Firebase Trigger Email extension with Gmail SMTP. The checked-in
   `extensions/firestore-send-email.env.example` documents the required values;
   keep the real `extensions/firestore-send-email.env` file out of Git.
5. Deploy the functions and extension:

```powershell
firebase deploy --only functions,extensions --project student-assessment-2d869
```

The first deployment prompts for:

- `INITIAL_ADMIN_EMAIL`: the exact email for the first Admin.
- `ORGANIZATION_NAME`: the name shown in invitation emails.
- `APPLICATION_URL`: the deployed application URL used after password setup.
  Production invitations return to `https://student-assessment-app.vercel.app`.

The configured initial Admin receives the Admin claim on sign-in. The fallback `initializeOrganizationAccess` callable can also assign the first Admin, but only when the signed-in email exactly matches `INITIAL_ADMIN_EMAIL` and no organization Admin exists yet.

The `inviteUser` callable writes the invitation message to the server-only
Firestore `mail` collection. The Trigger Email extension sends the queued
message through Gmail SMTP and records delivery status on the mail document.

## SQL Connect hardening and APP-079 rollout

APP-079 now routes full-workspace reads and writes through authenticated callable Functions. The server returns the complete workspace only to Admins. A Teacher / EA receives only the current school year, assigned grade and home room, matching students, assessments whose grade scope includes the assignment, and evaluator-visible fields. Teacher / EA saves can change only non-calculated assessment values in that exact scope; roster, placement, template, historical-year, restricted-field, import, audit, and team data are server-owned.

The callable layer serializes workspace writes with a short Firestore lease and rejects stale workspace versions, preventing an evaluator save from overwriting a newer Admin or evaluator save. The browser no longer calls the full-workspace SQL Connect operations directly.

Before production, every authenticated SQL Connect operation must also require the organization claim:

```graphql
@auth(
  expr: "auth.token.organizationId == 'student-assessment' && auth.token.role in ['admin', 'teacher_ea']"
)
```

Admin-only operations must require:

```graphql
@auth(
  expr: "auth.token.organizationId == 'student-assessment' && auth.token.role == 'admin'"
)
```

The connector source now makes `GetPrototypeWorkspaceState` and `SavePrototypeWorkspaceState` `NO_ACCESS`, allowing only the Admin SDK in the trusted callable Functions to execute them. `ListStudents`, `CreateStudent`, and `UpdateStudentName` require the organization Admin claim. Unused definition-list operations that could expose years or restricted assessment fields are also `NO_ACCESS`.

Deploy these changes in this order so existing production data remains intact and older clients are not locked out before the replacement path exists:

1. Deploy `loadAuthorizedWorkspaceState` and `saveAuthorizedWorkspaceState` from the `invite-auth` Functions codebase.
2. Deploy the web application that uses the callable workspace API.
3. Verify one Admin and one assigned Teacher / EA can load and save through the callable API.
4. Deploy the SQL Connect connector authorization changes last.
5. Repeat the negative tests: the Teacher / EA cannot retrieve another room, another grade, a prior year, an Admin-only field, or modify roster/placement data.

This rollout does not rewrite or delete the existing `PrototypeWorkspaceState/main` row. Normalizing that JSON into the relational enrollment/result tables remains a later data-model migration, not a prerequisite for the callable server boundary.

Cloud Storage rules must be migrated separately to the same `organizationId`, `role`, and classroom-scope claims before evaluator file fields are enabled.

## Security assessment

The invitation mechanism is secure when the callable functions, blocking functions, custom claims, and matching SQL Connect and Storage authorization rules are all deployed.

Recommended follow-up controls:

- Require MFA for Admin accounts.
- Enable Firebase App Check for the web app, SQL Connect, callable functions, and Storage.
- Keep email enumeration protection enabled.
- Record invite, role-change, and access-revocation events in the audit log.
- Revoke refresh tokens whenever a role changes or a user is removed.
- Publish a server-owned `accessChanges/{uid}` notification when a role, grade, or homeroom changes. The signed-in client refreshes its token from that notification and discards any older async membership result whose UID/session generation is no longer current.
- Add an Admin action to disable a user rather than deleting their historical audit identity.

## Single-organization alternative

Firebase Identity Platform multi-tenancy is unnecessary for one organization. Keep a single organization claim and one user directory.

If the school controls a Google Workspace domain, an even simpler long-term option is:

1. Admin adds the staff email and role to the organization.
2. Staff signs in with their managed Google Workspace account.
3. The server matches the verified email to the invitation and issues the role claim.

That removes application passwords and password-reset support entirely while preserving Admin-controlled membership.
