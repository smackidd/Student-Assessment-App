# Chart and Excel report release

Scheduled Production start: **2026-11-23 19:00 UTC-06:00 (2026-11-24 01:00 UTC)**.
This release includes Dashboard filters and Progression series, Classroom Groups,
private-by-default saved favorites with optional staff sharing, and native styled
Excel charts for the selected Student Report charts.

## Required migrations

1. `MIG-20261121-001`: classroom groups and owner-scoped filter favorites.
2. `MIG-20261123-001`: Dashboard multi-student selectors and opt-in favorite sharing.

Apply these together as one additive `firestore:rules` release to
`student-assessment-2d869`. No document refilling, indexes, SQL, Data Connect,
Storage, Functions, or Authentication changes are required. The repository's
generic policy is not the Production deployment artifact. Preserve the existing
Production school-domain restriction, account exception, and all unrelated rules.

Reviewed Production baseline: ruleset `91f3a4aa-9733-4690-acad-1168a18ffdba`,
normalized SHA-256 `ddb147cf00f74d70f9b1d7ab3c452f8fc3b39036940962347d53f5446c665d8f`.
Both migration blocks plus their membership helper are additive. The staged
Production result is byte-for-byte identical after newline normalization to
verified Test ruleset `d5916646-53ba-40f8-9021-69198d88cefd`, SHA-256
`77c2098cdcc52846643829969443c1dc5eaf788458c38da05e293cefb2340497`.

## Cutover and rollback

Before changing rules, build an unassigned Production-configured deployment on
`student-assessment-app` and verify the public alias still points to its prior
deployment `dpl_9x64hxkBJwG1pT1pAEHMx33nLgc7`. Recheck and back up the baseline
rules, deploy the reviewed rules, and read back the exact hash. Only then promote
the new web build and verify the public alias and compiled Firebase assignment.
Capture the resulting ruleset and deployment IDs in the local release log and
record applied status in the migration ledger after verification.

If rollback is needed, use the captured prior web deployment and Production
rules, not the generic checked-in file. Leave all preferences and classroom group
documents intact. Legacy clients may be unable to edit new-format favorites;
prefer a forward fix to rewriting preference data.
