# Quick Write percentile range decision

The project owner's 2025-26 CBM workbooks in `project-resources/Lindseys spreadsheets/_CBM Tracking Spreadsheets 25-26` show Quick Write `%ile` as labels such as `<1%`, `1-19%`, and `20-39%`. Grades 3-4 have entered examples, but no `%ile` formulas or complete grade/window cutoff table. Grades 5-9 have empty `%ile` cells, and Grades 10-12 have no `%ile` column. The entered examples cannot determine an official CWS-to-percentile lookup across all grades and windows.

For local testing, `quick_write_percentile` uses the following workbook-supported lower-band boundaries. Each boundary is evidenced by adjacent integer CWS scores on opposite sides of `<1%` and `1-19%`; scores below the `<1%` example are inferred to remain in `<1%` because percentile rank should be nondecreasing with CWS. These are partial, provisional rules, not a complete school-approved norms table.

| Grade | Window | Calculated `<1%` when CWS is | Workbook examples (`Quick Write` tab) |
| --- | --- | --- | --- |
| 3 | January / Winter | 0-1 | `H7:I7` = 1 / `<1%`; `H10:I10` = 2 / `1-19%` |
| 3 | May / Spring | 0-2 | `L5:M5` = 2 / `<1%`; `L7:M7` = 3 / `1-19%` |
| 4 | September / Fall | 0 | `D4:E4` = 0 / `<1%`; `D5:E5` = 1 / `1-19%` |
| 4 | February / Winter | 0-3 | `H7:I7` = 3 / `<1%`; `H4:I4` = 4 / `1-19%` |

The Grade 3 Fall workbook labels even CWS 0 as `1-19%`, so that window has no `<1%` rule. Grade 4 Spring and grades 5-12 also have no supported `<1%` boundary. In all other cases, CWS is ranked within the current school-year, grade, and assessment-window cohort and displayed as `<1%`, `1-19%`, `20-39%`, `40-59%`, `60-79%`, `80-99%`, or `>99%` with a visible `(cohort est.)` suffix. A small cohort will not necessarily produce a `<1%` estimate. The upper bands extend the workbook's observed 20-point label pattern for testing; they are not official grade/window cutoffs. A missing CWS leaves `%ile` blank.

An imported workbook `%ile` range is retained without the suffix as the authoritative source value for that student, year, grade, and window. Editing a source input removes that imported calculated override and recomputes the applicable workbook-supported `<1%` result or visibly marked provisional cohort range. This can legitimately differ greatly from the imported norm label where no supported boundary exists. The calculated field remains read-only. A future school-approved norm table can replace the provisional rules without changing the `quick_write_percentile` key.

ORF is unchanged. The supplied `2017_ORF_NORMS.pdf` gives discrete Hasbrouck & Tindal CWPM anchors at P10, P25, P50, P75, and P90, but does not prescribe percentile-range labels. The existing ORF calculation therefore continues to display its documented single published anchor (or P1 below P10), rather than Quick Write's range convention. See `docs/orf-percentile-source-decision.md`.

This is application-only work. No Cloud SQL/Data Connect schema, data migration, Firebase Authentication change, or bulk rewrite is required. The branch was deployed to the isolated Test Vercel project on 2026-09-22; Production is unchanged. Deployment evidence is recorded in `docs/migrations.md`.
