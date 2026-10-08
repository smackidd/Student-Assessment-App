# Invite-only Google authentication

## Decision and scope

On 2026-10-08 the owner authorized merging master into `feature/foothills-google-sso`, completing the school-only policy with one exact outside email exception, and deploying to Test. Test is now deployed with Google as the only enabled sign-in provider and three existing allowed-member accounts migrated. The live Google entry screen is verified; completed real-account sign-in and invitation acceptance remain pending. Production remains pending. See `MIG-20261008-001` in [migrations.md](migrations.md).

Every organization member must use Sign in with Google. Foothills staff require an exact `foothillsacademy.org` email and Google's trusted Workspace hosted domain. One outside address may be authorized through the server-only `APPROVED_EXTERNAL_EMAIL` Function parameter; empty or invalid configuration disables that exception. Every allowed account still needs an existing administrator-issued membership and role. Google sign-in never creates membership or promotes an Admin.

## Invitations

1. An Admin enters the person's name, exact email and role. The server accepts a school address or the one configured outside address.
2. The Admin SDK reserves the Firebase user without a password, preserving a pending reservation's UID. It assigns `organizationId`, `role`, `authMethod: "google"`, and normalized `invitedEmail` claims, preserving classroom and other existing claims.
3. The server queues the Google sign-in instructions through the existing Trigger Email extension. The email links to the configured app URL with `invited=google`. It grants no access by itself and contains no password setup link.
4. The app signs out any current browser account before the invitation handoff, then presents Google sign-in. Old `invited=1` links also lead to Google sign-in after migration.
5. Google authenticates the exact invited account. Firebase's one-account-per-email setting must retain the existing or reserved UID and custom claims. The assigned Admin or Teacher / EA permissions continue to apply.

An uninvited school account, another invited person's Google account, any other outside account, consumer Google account pretending to be school-managed, unverified identity, and password sign-in are rejected.

## Identity enforcement

The blocking sign-in Function checks organization membership, role, migration marker, current Google provider, verified Firebase email, exact invitation binding and trusted Google profile. The school profile must have `hd: "foothillsacademy.org"`. The browser supplies no school-only account chooser filter so the approved outside account remains selectable.

The exact outside account must use Gmail or a managed Google Workspace mailbox. A non-Google-hosted mailbox merely registered as a Google account is not supported by this implementation; it would need a separately implemented mailbox-verification enrollment flow. Managed Workspace aliases are supported when Google supplies a trusted hosted domain, even if the alias suffix differs. Optional profile verification fields must agree when supplied.

Callable Functions independently enforce Google provider, verified email, exact invitation identity, and the current configured allowlist. The client uses the same signed membership marker/provider/email binding before showing the workspace. Initial-Admin bootstrap no longer grants or promotes roles.

Direct resource authorization must also reject old unmarked/password tokens. `scripts/stage-test-google-sso-resources.cjs` creates ignored Test-only source with matching Google, verified-email, school/exact-outside and identity-binding guards for four direct SQL Connect operations, Firestore and Storage. It preserves all `NO_ACCESS` operations, existing Storage role restrictions and canonical workspace-root source. Deploy only the SQL Connect connector selector, not its schema. Stale sessions may read only their own server-owned access-change/revocation notification so the browser can sign out; they cannot write those notifications.

## Test account migration and release

Before remote writes, record the release in the migration ledger. Deploy reviewed blocking/callable Functions and Google provider configuration explicitly to `student-assessment-test`. `firebase.auth-test.json` is the Test-only Google provider definition; its CLI setup requires Firebase CLI 15.6.0 or newer. The OAuth audience must support External accounts; the app's membership policy restricts access. Authorized origins and the provider callback must match Test. Email authentication is disabled in Test after the reviewed account migration; existing credentials are retained for recovery. Firebase CLI 15.6.0 ignores `emailPassword: false`: use the narrow Identity Platform configuration update with `updateMask=signIn.email.enabled` and `{ "signIn": { "email": { "enabled": false } } }`, then verify Google and both blocking triggers remain enabled.

The controlled migration tool [google-sso-migration.md](google-sso-migration.md) defaults to a reviewed dry run. Applying it requires exact Test project assertions and the reviewed plan hash, provider readiness, an eligible enabled Admin, and a Windows CurrentUser DPAPI recovery snapshot before any write. It retains user IDs, roles, grade/homeroom, unrelated claims and credentials, then revokes eligible users' refresh tokens. Excluded accounts are unchanged and the strict policy rejects their app access.

Do not copy Test user or student records to Production. No SQL schema or student-data migration is part of this release. Changing the outside exception later requires regenerating the direct-resource guards and reviewing/revoking that account's existing sessions. Existing Google ID tokens have a finite lifetime; refresh-token revocation alone does not immediately invalidate every previously issued token.

## Verification boundaries

Offline policy and migration tests cover exact-email exceptions, wrong domains/provider/account, missing claims, legacy session rejection, role preservation, stale-plan guards and recovery ordering. App and Function builds and typechecks must pass before deployment.

Real Google OAuth must still prove: first reserved/existing-account sign-in retains UID and claims; school profiles deliver trusted `hd` on first and repeat sign-in; approved outside access succeeds; other school/outside/password attempts fail; classroom restrictions and assigned roles survive migration. Actual invitation delivery requires an explicitly authorized recipient. No invitation email is sent merely by deployment or migration.

## Official references

- [Firebase Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase provider configuration with CLI](https://firebase.google.com/docs/auth/configure-providers-cli)
- [Firebase blocking functions](https://firebase.google.com/docs/auth/extend-with-blocking-functions)
- [Google hosted-domain and mailbox verification](https://developers.google.com/identity/sign-in/web/backend-auth)
- [Google OAuth audience](https://support.google.com/cloud/answer/15549945)

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

The access boundary depends on the callable functions, blocking functions, custom claims, and matching SQL Connect and Storage authorization rules being deployed together. The matching Test Functions, provider and direct-resource guards have been deployed and independently read back; the live Google entry screen has been checked. Completed real-account OAuth, reserved/existing UID linking and role/classroom acceptance remain the integration gates above. Production has not been changed.

Recommended follow-up controls:

- Require MFA for Admin accounts.
- Enable Firebase App Check for the web app, SQL Connect, callable functions, and Storage.
- Keep email enumeration protection enabled.
- Record invite, role-change, and access-revocation events in the audit log.
- Revoke refresh tokens whenever a role changes or a user is removed.
- Publish a server-owned `accessChanges/{uid}` notification when a role, grade, or homeroom changes. The signed-in client refreshes its token from that notification and discards any older async membership result whose UID/session generation is no longer current.
- Add an Admin action to disable a user rather than deleting their historical audit identity.
