# Invite-only authentication

## Decision

**2026-09-18: LOCAL ONLY.** The Google invitation workflow is being prepared on a local branch. It has not been deployed or applied to `student-assessment-test` or production. No provider settings, remote accounts, invitation email queues, or database records have been changed for this work. See `MIG-20260918-001` in [migrations.md](migrations.md).

New invitations, and pending invitations reissued through the updated Admin flow, require **Sign in with Google** using the exact invited `foothillsacademy.org` Google Workspace account. The server enforces invitation membership, the current Google sign-in provider, verified email, the exact invited email, and Google's hosted domain. Gmail addresses, other domains, subdomains, and uninvited school accounts do not qualify for a new invitation.

Existing active accounts are not migrated. Their existing sign-in method and claims remain compatible until a separate migration is approved. Google SSO does not introduce Firebase MFA or a new email-verification workflow for those legacy accounts.

## Roles

- **Admin** can invite users, assign roles, view the organization user list, and change another user's role.
- **Teacher / EA** can sign in to the assessment workspace but cannot invite users or change roles.

Firebase Auth custom claims are the source of truth. New and reissued invitations include:

```json
{
  "organizationId": "student-assessment",
  "role": "teacher_ea",
  "authMethod": "google",
  "invitedEmail": "staff@foothillsacademy.org"
}
```

The Admin claim uses `"role": "admin"`; Teacher / EA uses `"role": "teacher_ea"`. The normalized `invitedEmail` binds access to the account the Admin invited. Role and classroom assignment updates preserve the authentication-policy claims.

Role values saved in browser state or the prototype workspace JSON are not trusted for authorization.

## Invitation flow

1. An Admin enters a name, `foothillsacademy.org` email, and role in the Team tab.
2. The `inviteUser` callable verifies the caller's Firebase ID token and Admin claim, then rejects invitations outside the exact school domain.
3. The Admin SDK reserves a Firebase Auth user with that email and **no password**. The email starts unverified. A pending reservation can be reused with the same UID; an already active organization member cannot be reinvited through this flow.
4. The function assigns the organization, role, `authMethod: "google"`, and normalized `invitedEmail` claims, then revokes existing refresh tokens. Reissuing a pending legacy invitation applies this policy without deleting the user's UID. It does not remove any old password credential; the Google-only guard rejects password sign-in even if an old reset link is used.
5. The function queues a branded invitation in the server-only Firestore `mail` collection. The configured Trigger Email extension delivers it through Gmail SMTP. Both text and HTML tell the recipient to choose Google with their invited account and explain that no application password is needed.
6. The email links directly to the configured `APPLICATION_URL` with `invited=google`. This is an app handoff link, not a credential, password-reset link, or one-time access token. Forwarding it grants no access.
7. The app waits for Firebase Auth initialization, signs out any current browser account, removes the handoff query parameter, and presents Google sign-in with an account chooser. The `invited=google` handoff hides the password form. Existing `invited=1` links remain supported for legacy password invitations and retain access to password sign-in. The browser's `hd` option guides account selection only.
8. With one account per email enabled, the verified Google identity is expected to attach to the reserved Firebase Auth UID. The blocking function verifies the invitation before Firebase issues a session; the app then reads the signed claims and exposes the assigned role's features. UID retention and real provider metadata remain required integration checks before release.

The `blockPublicSignUp` blocking function continues to reject all client-created accounts. The reservation exists before the recipient signs in, so a valid invited user signs into an existing account. An uninvited Google account cannot create itself through public sign-up.

## Server enforcement and legacy compatibility

For accounts marked `authMethod: "google"`, `blockUninvitedSignIn` requires all of the following:

- Current sign-in metadata identifies `google.com`; linked providers alone do not satisfy this check.
- The Firebase email is verified, belongs to the exact school domain, and matches the normalized `invitedEmail` claim.
- The Google profile supplied by Firebase has `hd: "foothillsacademy.org"` and an email matching `invitedEmail`. Missing or inconsistent metadata fails closed.
- The existing organization claim and valid Admin or Teacher / EA role grant membership.

Callable authentication guards independently check marked tokens' `firebase.sign_in_provider`, verified email, and invited-email binding. Password sign-in cannot satisfy this policy merely because Google is linked to the account. Client validation is an additional usability check, not the access boundary.

Unmarked legacy accounts keep the existing policy. Initial-Admin compatibility is limited to unmarked accounts without an existing organization claim whose email matches `INITIAL_ADMIN_EMAIL`; existing assigned roles take precedence. The `initializeOrganizationAccess` fallback also checks that no organization Admin exists. A marked Google account cannot use either bootstrap path to bypass invitation policy or promote its role.

Blocking checks run during sign-in; they do not continuously revalidate existing sessions with Google Workspace. Revoking refresh tokens does not immediately invalidate every already issued ID token. Any later bulk migration or immediate account-removal requirement needs a separately reviewed session and resource-authorization plan.

## Future Firebase setup and release gates

These steps are pending and require a separately authorized test rollout. Do not run deployments, create remote users, send invitations, or change provider settings as part of the current local work.

1. Review the project-specific Firebase Authentication configuration, retaining Identity Platform and both registered blocking functions. Enable the Google provider in the authorized test environment, with its approved support email and OAuth configuration.
2. Require **one account per email** / **Link accounts that use the same email**. Multiple accounts per provider would undermine the reserved-UID flow. Verify the first Google sign-in retains both the reservation's UID and custom claims.
3. Configure only the approved application origins in Authentication's authorized domains, including localhost if a later authorized local-to-test OAuth check needs it. Confirm the school permits this OAuth application in Google Workspace.
4. Retain Email/Password for the active legacy users while the Google-only blocking policy protects marked invitations. Disabling it globally or migrating existing users is a separate decision.
5. Verify that `APPLICATION_URL` points to the intended environment and that the existing Trigger Email extension is configured as intended. An invitation call writes to `mail` and can send an actual message; use an explicitly approved test recipient or email sink during future integration testing. The checked-in `extensions/firestore-send-email.env.example` describes configuration; keep actual SMTP values out of Git.
6. Deploy the reviewed blocking functions, callable guards/invitation changes, and compatible web application to test only after authorization. Record the precise applied revision and evidence in the migration ledger before considering a separate production release.

Relevant existing Function parameters are:

- `INITIAL_ADMIN_EMAIL`: the exact email for the first Admin.
- `ORGANIZATION_NAME`: the name shown in invitation emails.
- `APPLICATION_URL`: the environment's application URL used for the invitation handoff.

Before promotion, verify a real managed school account supplies `additionalUserInfo.profile.hd` and the expected profile email to the blocking function on both first and subsequent Google sign-ins. Missing `hd` must remain a rejection. The Firebase Auth emulator's fake Google profile may omit this field, so mocked policy tests alone do not prove the real OAuth flow.

The future integration checklist includes: first invite and repeat sign-in with the reserved UID; another school account; uninvited school account; consumer Google account or wrong hosted domain; Gmail and subdomain rejection; missing/unverified/mismatched email; password-reset and linked-password attempts against marked accounts; pending legacy invitation reissue; active legacy Admin sign-in; assigned-role preservation; invitation handoff from another browser account; and actual email delivery to the approved recipient. Local tests and isolated browser rendering do not establish these remote integration results.

For rollback after rollout, stop issuing new invitations while investigating and prefer a forward fix. Keep the Google-only blocking and callable guards for every marked account; do not clear `authMethod`/`invitedEmail` or restore permissive guards as a shortcut. Reverting only the web interface can make Google users unable to sign in, so retain a compatible Google sign-in route. No Cloud SQL/Data Connect schema or data migration is part of this authentication change.

## Local validation

The full offline test suite, application and Functions typechecks, and application and Functions builds passed. Local browser rendering was checked with dummy Firebase configuration and a Content Security Policy that denied outbound connections. This exercised the local interface without sending requests to configured test or production Firebase services.

These checks do not verify real Google OAuth, provider enablement, managed-school profile metadata, reserved-UID linking, or invitation email delivery. Those integration checks remain pending for a separately authorized test rollout.

## Official references

- [Firebase Google sign-in for web](https://firebase.google.com/docs/auth/web/google-signin): provider setup and popup sign-in.
- [Firebase blocking functions](https://firebase.google.com/docs/auth/extend-with-blocking-functions): current sign-in event metadata and checks before token issuance.
- [Google account and hosted-domain verification](https://developers.google.com/identity/sign-in/ios/backend-auth): why `hd` distinguishes managed Workspace accounts from consumer accounts using external email.
- [Identity Platform account linking](https://cloud.google.com/identity-platform/docs/link-accounts): one-account-per-email configuration and credential conflicts.
- [Firebase Auth emulator implementation](https://github.com/firebase/firebase-tools/blob/master/src/emulator/auth/operations.ts): source-level evidence for verified-IdP reuse of an existing email reservation; this is not a substitute for the pending real-provider integration test.

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

The access boundary depends on the callable functions, blocking functions, custom claims, and matching SQL Connect and Storage authorization rules being deployed together. The local Google SSO changes do not establish a verified remote security posture; the setup and integration gates above remain pending.

Recommended follow-up controls:

- Require MFA for Admin accounts.
- Enable Firebase App Check for the web app, SQL Connect, callable functions, and Storage.
- Keep email enumeration protection enabled.
- Record invite, role-change, and access-revocation events in the audit log.
- Revoke refresh tokens whenever a role changes or a user is removed.
- Publish a server-owned `accessChanges/{uid}` notification when a role, grade, or homeroom changes. The signed-in client refreshes its token from that notification and discards any older async membership result whose UID/session generation is no longer current.
- Add an Admin action to disable a user rather than deleting their historical audit identity.
