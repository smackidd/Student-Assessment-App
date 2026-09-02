# Beta issue deduplication

Source reviewed: the shared Student Evaluations beta checklist, filtered to the 25 test items where Steve's result was `Issue`, on 2026-08-09.

Those 25 findings resolve to 17 distinct application work items. Repeated findings about the same behavior were combined. The `audit-persistence` note described two separate failures (cross-account identity and missing shared audit history), so its two concerns are tracked by APP-078 and APP-080 without creating duplicate cards.

| Mission Control card | Checklist source IDs | Deduplicated work |
| --- | --- | --- |
| APP-078 | `account-invited-signup`, `invite-production-link`, `audit-persistence` (identity portion) | Isolate authenticated identity, invitation handoff, and cross-account session state. |
| APP-079 | `role-evaluator-table`, `role-scope` | Enforce evaluator year, grade, homeroom, student, and assessment scope. |
| APP-080 | `role-audit-actor`, `audit-accuracy`, `audit-persistence` (history portion) | Attribute append-only shared audit events to the authenticated actor and preserve multi-user history. |
| APP-081 | `audit-sort` | Add stable Actor sorting to the Audit Log. |
| APP-082 | `nav-profile-summary`, `profile-edit`, `team-list` | Make identity/classroom fields read-only in Profile and manage teacher assignments from Team. |
| APP-083 | `overview-new-year` | Let Admins delete only eligible unlocked school years. |
| APP-084 | `overview-add-homeroom` | Replace count spinners with validated whole-number entry and select-on-focus behavior. |
| APP-085 | `overview-rename` | Lock HR cells and add stable-ID student search/navigation without changing cohort calculations. |
| APP-086 | `overview-move-existing` | Restrict student moves to homerooms that already exist. |
| APP-087 | `overview-remove-restore` | Restore a re-added student's same-year assessment history. |
| APP-088 | `overview-options` | Move Overview Options to the right side of the toolbar. |
| APP-089 | `import-revert` | Show rollback progress and prevent a partial or misleading import rollback. |
| APP-090 | `entry-types` | Prevent focus flicker and dropped digits during fast keyboard entry. |
| APP-091 | `entry-invalid-numeric`, `calc-cwpm` | Enforce field validation, Score/Total rules, and calculated-field locking. |
| APP-092 | `entry-persistence` | Restore the last authorized tab per signed-in user. |
| APP-093 | `calc-orf-percentile-map` | Implemented Hasbrouck & Tindal 2017 Fall/Winter/Spring percentile anchors for Grades 1-6 with no `ORF_MED >= 50` cutoff. Grade 1 Fall remains blank because the source provides no norm; school policy confirmation remains a production gate. |
| APP-094 | `reliability-large-import`, `reliability-save-time` | Improve and profile SQL synchronization for larger rosters. |

Two requested operational cards were added separately because they were not duplicates of Steve's checklist findings:

- APP-095: MFA enrollment, challenge, unenrollment, and recovery.
- APP-096: SQL backups, point-in-time recovery, and rollback runbooks.

Current result: 19 cards total, comprising 17 deduplicated beta issues plus the two operational cards.
