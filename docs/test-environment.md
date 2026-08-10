# Test environment

The hosted test environment is isolated from production.

## Resource map

| Resource | Test | Production |
| --- | --- | --- |
| Firebase project | `student-assessment-test` | `student-assessment-2d869` |
| Firebase alias | `test` | `production` |
| SQL Connect service | `student-assessment` | `student-assessment` |
| Cloud SQL instance | `student-assessment-db` | `student-assessment-db` |
| PostgreSQL database | `student_assessment` | `student_assessment` |
| Vercel project | `student-assessment-test` | `student-assessment-app` |
| Application URL | `https://student-assessment-test-beta.vercel.app` | `https://student-assessment-app.vercel.app` |

The repeated SQL resource names are safe because they live in different Firebase and Google Cloud projects.

## Deploy test

Run validation from `student-evaluation-app`:

```powershell
npm test
npm run typecheck
npm run build
```

Deploy backend resources with an explicit project alias:

```powershell
firebase deploy --only firestore:rules,functions:invite-auth --project test
```

Deploy SQL Connect and Storage from the workspace root:

```powershell
firebase deploy --only dataconnect,storage --project test
```

The dedicated Vercel project stores `NEXT_PUBLIC_APP_ENV=test` and the test Firebase configuration in its Production, Preview, and Development scopes. `lib/firebase.ts` rejects a test build that resolves to the production Firebase project.

Deploy the current working copy to the stable test site without changing the local production Vercel link:

```powershell
npm run deploy:test
```

Use `npm run deploy:test -- -Preview` when a one-off preview deployment is preferred over updating the stable test URL.

## Promotion gate

1. Deploy the candidate to the test site.
2. Run automated tests and complete user acceptance testing with synthetic or anonymized data.
3. Apply and verify database migrations in test.
4. Back up production before a production migration.
5. Deploy the same reviewed commit to production.

Never copy identifiable student data into the test project.

## Remaining integration requirements

- The Trigger Email extension needs a test-only SMTP credential or explicit approval to reuse the existing SMTP credential before invitation delivery can be exercised end to end.
- Before the next production release, verify management access to the Vercel production project. The documented production URL currently responds, but the project ID saved in the local `.vercel/project.json` is not visible to the currently authenticated Vercel team.
