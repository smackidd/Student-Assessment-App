# Test Google SSO account migration

`scripts/migrate-test-google-sso.cjs` updates Authentication claims in **student-assessment-test only**. It does not create/delete accounts, remove passwords, enable accounts, promote roles, send invitations, or touch student/SQL data. Execution evidence belongs in [migrations.md](migrations.md). Production is deliberately unsupported.

## Access and identity

Existing `student-assessment` organization members with an existing `admin` or `teacher_ea` role qualify when their email is in the exact `foothillsacademy.org` domain or matches the one configured external exception. The tool adds `authMethod: "google"` and the normalized `invitedEmail`, preserving the UID and all other custom claims, including grade and homeroom. Disabled eligible members keep their disabled status.

Other outsiders, invalid roles, tenant accounts, and accounts in other organizations are untouched. The tool reports excluded-member counts. Untouched outsiders must still be rejected by the deployed access policy; migration does not grant them a password fallback. An exception waives only the school-domain requirement: the account still needs membership, Google authentication, verified identity, and the existing assigned role.

The command's exact `--external-email` must match the deployed `APPROVED_EXTERNAL_EMAIL` Functions parameter. Omitting it disables the exception for the plan. Do not put an email list, wildcard, or organizational domain in that parameter.

## Before applying

1. Deploy the reviewed Google-only blocking/callable policy and compatible Google sign-in interface to Test. Deploy the corresponding direct-resource authorization rules. Confirm the precise revision and resource configuration in the migration ledger.
2. Enable the Test Google provider, require one account per email (link accounts that use the same email), and retain both invitation/account-creation and sign-in blocking functions. The migration preflight reads these settings and refuses unsafe/missing configuration.
3. Confirm the authorized application domains and Google OAuth audience permit the approved outside Google account. The server allowlist remains restrictive.
4. After the controlled Test migration and before Production promotion, verify first Google sign-in against an existing Firebase password account and a passwordless invitation reservation retains the original UID and custom claims. Verify a real managed school account supplies the expected Google profile email and `hd`, on both first and repeat sign-in. No migration test or provider-setting check proves these OAuth behaviors.
5. Pause concurrent invitations, role changes, classroom assignments, and account management during plan review/application. Firebase custom-claims writes have no compare-and-swap API; the tool detects observed changes before application and before each mutation, but it cannot exclude a competing write inside that API interval.

An existing enabled eligible Admin is required to apply; the tool never promotes an account to manufacture one. A linked Google Admin is not a prerequisite, because a verified Google provider may link at the first authoritative sign-in. If a credential-conflict error occurs instead, stop and resolve the linking path while retaining the same UID. Do not delete/recreate the account, loosen public signup, clear the Google marker, or introduce a password-only bypass.

## Review and apply

Run from `student-evaluation-app` after installing application/Functions dependencies and logging in to Firebase CLI. The tool reuses that CLI account; `--account` can select an already logged-in operator. It does not ask for or print passwords or OAuth tokens.

```powershell
node --test scripts/migrate-test-google-sso.test.cjs
node scripts/migrate-test-google-sso.cjs --project student-assessment-test --external-email owner@example.com
```

Replace `owner@example.com` with the approved exact outside email. The second command defaults to **dry-run**, reads Test accounts, and writes a review plan under ignored `.tmp/google-sso-migrations/<run>/plan.json`. Its console summary contains counts, the local plan path, and a SHA-256; it does not print staff names, email addresses, or UIDs. Review the private plan locally without copying staff records into public issues or logs.

Plans expire after 30 minutes. Apply requires the same exact exception, the explicit Test confirmation, the reviewed file, and its hash:

```powershell
node scripts/migrate-test-google-sso.cjs --apply --project student-assessment-test --external-email owner@example.com --confirm-project student-assessment-test --plan ".tmp/google-sso-migrations/<run>/plan.json" --confirm-plan "<reported SHA-256>"
```

The tool compares the current organization inventory with the reviewed identities and claims. Before the first remote mutation, it writes and round-trip verifies a Windows DPAPI recovery copy containing original claims and account metadata. The encrypted copy is scoped to the current Windows user; retain it on the same protected workstation/account. Password hashes and salts are excluded because credentials are never changed. The plaintext review plan contains staff identities and claims; keep the entire ignored folder private. The Test deployment script explicitly excludes `.tmp`.

Each eligible account receives the planned policy and a refresh-token revocation, including accounts already marked Google-only. The private `journal.jsonl` records write intent, claims completion, token revocation, and post-write verification by UID. Verification checks UID, email, verified/disabled status, role, scope, unrelated custom claims, linked providers, and the final organization inventory.

## Sessions and recovery

Refresh-token revocation requires a fresh authentication session. It does not itself invalidate every already issued Firebase ID token immediately. Updated Google-only access checks reject old password/unmarked tokens; any remaining already marked Google sessions remain subject to normal token expiry and the deployed resource policy. Do not claim instant global session termination from the migration alone.

There is no transaction across Firebase Authentication accounts. If a write/revocation fails, the tool stops and keeps its private recovery copy and per-account journal; it does not retry or automatically roll back. Read the journal to determine which accounts changed. Fix the cause, perform a new dry-run, review its plan, and apply again. Already marked eligible accounts are still revoked on a rerun, so an interrupted claims-write followed by failed revocation can be completed.

Prefer completing the Google-only policy. Restoring old custom claims from the DPAPI copy is a separately reviewed recovery operation and may weaken access or make the current interface unusable. Restoring claims does not undo token revocation. Never restore production accounts with this tool.

Record the applied revision, counts, backup/journal locations (without staff identities), and actual integration results in the migration ledger. Offline tests cover project/plan guards, selection, identity/role/credential preservation, stale review, backup failure, partial failure, and revocation recovery. Live Google sign-in, `hd` metadata, reserved-UID linking, rejection scenarios, and email delivery require separate integration evidence; sending an invitation also sends an actual email.
