# Star Math and Star Reading PDF Imports

In **Report Files**, select **Year, Grade, Assessment and Round**, then choose one
or more original Star Math or Star Reading Instructional Planning - Student Report PDFs. Each
class PDF may contain several students and continuation pages.

The right-hand verification table shows student matches, test dates, extracted
scores and any validation issues. Verified rows are selected by default; uncheck
any rows you do not want to import. **Import verified rows** saves the selected
values using the existing authorized Firebase workspace save. It replaces only
matched fields in that student's selected year, grade, assessment and round.
Other years, rounds, students and unmapped optional fields stay unchanged.

Rows needing attention are skipped without blocking verified rows. Clicking
**Import verified rows** also downloads a UTF-8 CSV containing the skipped
reports, PDF filenames/pages, selected and source year/grade, extracted scores,
and validation reasons. **Download attention CSV** is available before and after
import, including batches with no verified rows. Valid unchecked rows are not
included in the CSV. Unreadable files/pages are listed separately and do not
invalidate readable students from the same PDF. The CSV preserves commas,
quotes and newlines and neutralizes spreadsheet formulas from PDF text.

Locked years, unsupported assessments and ambiguous field mappings still block
the entire import. Duplicate otherwise-valid reports remain flagged rather than
silently choosing which score to overwrite.

## Matching Rules

- Match the report's Star Math or Star Reading assessment identity, grade and test date, not its
  filename or print date. School years run August through July; Fall is
  August-December, Winter January-March, and Spring April-July.
- Use the selected year's assessment definition, including its fields, sections
  and round configuration. A custom round needs a recognizable season or month.
- Recognized fields are PR / Percentile Rank / %ile, SS / Scaled Score, and
  Projected SS / Projected Scaled Score. Star Reading additionally matches IRL /
  Instructional Reading Level and ZPD / Zone of Proximal Development. Match
  abbreviations, full headings, or field slugs within the selected year's
  definition. The report must contain every recognized
  field configured for that grade and round. Required fields without a supported
  metric prevent import; optional unmatched fields remain untouched.
- Configure IRL and ZPD as Text. Preserve decimal levels (including `4.0`),
  source codes `PP`, `P`, `PHS`, and ranges such as `3.2 - 5.1` exactly; never
  round a reading level into an integer or infer a score from the benchmark graph.
- Validate each student's results heading against the selected assessment;
  mixed Math/Reading files cannot write scores into the wrong assessment. Later
  score pages need not repeat the document title, but must identify their results.
- Match existing students assigned to the selected year and grade. Normalize
  Last, First order, case, spacing, accents, parenthesized name annotations and
  pronoun suffixes. Never fuzzy-match, create students, or change enrollments.
- Ambiguous student names, duplicate reports, multiple columns matching one
  metric, invalid values and locked years are blocked and explained in the table.
- PDF values are authoritative, including matching calculated fields. Repeating
  an unchanged import is a no-op.

## Privacy and Reversal

PDF text extraction runs on the user's device with a version-matched PDF.js worker.
The original PDFs are not uploaded. The limits are 20 PDFs per batch, 20 MB per PDF,
100 MB total, and 200 pages per PDF. Scanned-image, encrypted and unreadable PDFs
are rejected; export the original text-based report from Star Math or Star Reading instead.

Score changes and before/after snapshots are saved together in existing import
history. The Audit Log entry provides the existing guarded Revert action, which
does not overwrite subsequent conflicting edits. While a save is pending, in-app
navigation is blocked and closing/reloading the browser triggers its unsaved-work
warning. Leaving while PDFs are only being read cancels extraction and saves nothing.

## Verification

- `npm test -- lib scripts/verify-star-math-pdfs.test.ts scripts/verify-star-reading-pdfs.test.ts`
- `node --test scripts/repair-import-values.test.cjs` (separate pre-existing Node tests)
- `npm run typecheck`
- `npm run build`

The optional local integration test reads all ten supplied class PDFs without
copying private student data into committed fixtures. It verifies 314 student
reports. Two source discrepancies intentionally remain flagged: Grade 11 file,
page 68 reports Grade 10; Grade 5 file, page 31 reports Grade 6.

The Star Reading integration test additionally checks all ten supplied Reading
PDFs (314 student reports), all five labeled metrics, the special IRL codes,
and a local in-memory PR/IRL/ZPD import from each file. No private source report
is added to the repository or uploaded during these tests.

Deployment is test-only through `npm run deploy:test`; no schema or Authentication
migration is required. See the `STAR-MATH-PDF-20261002` release ledger entry.

Browser acceptance on the test site confirmed all 14 Grade 4 reports matched the
2025-2026 roster. Changing to Winter or 2026-2027 blocked every Fall 2025 row and
disabled importing; restoring the correct selections made the rows available.
One verified PR value was saved, survived a fresh reload in the correct Fall
column, and was then reversed successfully through Audit Log. The verification
import is marked reverted. The owner assisted with native file selection and the
Revert confirmation; automated browser control could not operate those dialogs.
