# Production ORF import repair — 25 September 2026

The owner authorized promotion of the existing Test importer fix, correction of prior
WPM import corruption from the designated For Import files, and a full comparison
of production assessment data with those source files.

## Release and correction

- Production deployment: `dpl_4E5D5ej9DsTpBeQ2XKncM3VtLFM5`, READY at
  `https://student-assessment-app.vercel.app/` (verified HTTP 200).
- Local release checks: 166 application tests, TypeScript, successful Vercel build;
  seven repair-tool guard tests also passed.
- Corrected **14,244 cells**: 6,247 numeric WPM values, 171 WPM values that should
  be blank, and 7,826 source CWPM overrides.
- The defect mapped CWPM to WPM via substring matching and left CWPM unstored.
  Source-calculated CWPM values were restored explicitly, preserving the policy
  that imported values take precedence over live recalculation.
- Only reviewed scoped `assessmentValues` keys were changed. Student identities,
  placements, templates, legacy unscoped fall caches, historical import snapshots,
  and other workspace data were preserved. Active grade/year views use scoped keys.
- No Cloud SQL/Data Connect schema, Authentication, or Function migration was needed.

## Verification and coverage

All 30 Combined Import workbooks were read from the three For Import folders under
`project-resources/Lindseys spreadsheets`. SHA256 fingerprints were checked for
every source; the workbooks were not modified. The Grade 5 2023-2024 workbook was
initially locked and was included after the owner closed it.

The final audit covered all 426 production students and all 875 existing
school-year/grade placements. It compared 54,732 mapped source cells, including
49,915 populated cells, using exact source headers independently of the importer's
substring logic. Every active stored assessment key was accounted for. The separate
normalized assessment session/result/value tables were empty; the app's saved
workspace holds the assessment values.

Seven name differences were punctuation-only. Each match was unique within the
year/grade and exact homeroom and corroborated by at least three unchanged non-ORF
source values. The existing production names were retained and the differences
are listed in the private report.

Each patch set was rehearsed and rolled back, then applied with an exact workspace
version, prior cell-value/key-existence checks, and the application's workspace
lock. Full non-target JSON equality was checked inside PostgreSQL. Only per-cell
rollback evidence, not a complete production export, was retained locally.

The independent post-repair audit at `2026-09-25T20:02:31.220Z` found no remaining
WPM/CWPM source mismatches for existing production placements. Spreadsheet numeric
percentages were converted from fractions to percentage points and compared at the
application's one-decimal precision. Blank and `n/a` source cells were treated as
missing, separately from zero.

## Remaining differences

| Item | Count | Explanation |
| --- | ---: | --- |
| Missing numeracy scores | 168 | Grade 4, 2024-2025 and 2025-2026. Source Number Facts Add/Subtract and Multiply/Divide labels were not mapped to the app's longer section names. |
| Missing Spelling zero-percent values | 6 | Source `%` headers were skipped. These six 0% source cells cannot be reconstructed by the live score/total calculation. |
| Numeracy totals displayed differently | 168 | Stored totals match the source; current provincial norms override them in the display. This includes Grade 4 Number Line (source 9, displayed 18) and older Grade 3 denominators. |
| Unsupported historical numeracy values | 190 | Grade 3 2023-2024 component percentages and older test sections are absent from the current assessment definition. Seventeen populated source columns are involved. |
| Homeroom differences | 4 | Source is blank and production has an assigned homeroom. |
| Name punctuation variations | 7 | Corroborated identity matches; production spelling retained. |

The owner excluded the 37 Grade 12 2023-2024 records from this reconciliation.
They were not imported or changed and are not counted as outstanding differences.
The report retains the workbook's coverage row, explicitly marked excluded.

An additional 2,123 cells display an application calculation where the workbook is
blank. These are listed separately from source-value corruption. Another 1,479
computed values match the source after percentage unit/precision normalization or
application total calculation and are not counted as mismatches.

The private Excel report in the workspace's `outputs/019fed54-e190-7180-9a04-30449b97d3e2`
folder lists every corrected cell and every remaining difference by student,
year/grade, assessment/window, source workbook/sheet/cell, source value, stored value,
and displayed value. It is not part of the application deployment or Git history.

## Operational note

The repair preserved old import snapshots as historical evidence. The existing
safe Revert Import check can reject a repaired old import because its current
values no longer equal the original imported snapshot. Do not rewrite that history
or bypass the guard. Use reviewed per-cell rollback evidence if reversal is needed.
