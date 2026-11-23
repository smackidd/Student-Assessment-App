# Isolated dashboard acceptance

From the app checkout, with its locked dependencies, Playwright Chromium, and
Poppler (`pdfinfo` and `pdftoppm`) installed:

```powershell
npm install --prefix verification/dashboard-ui --no-save --package-lock=false esbuild@0.27.0
node node_modules/@playwright/test/cli.js test --config verification/dashboard-ui/playwright.config.cjs --reporter=line
```

The first command installs only the fixture bundler under this verification
directory; it does not modify the application's manifests or dependencies.

No development server, Firebase project, credentials, emulator, existing
browser profile, or live records are needed. Playwright intercepts the fixture
origin and fulfills its HTML, JS, and CSS in memory. Requests outside that
allowlist fail the test. A restrictive CSP also disallows network connections.
Each test gets a new context; a reload retains only that context's fixture data.

The build exposes the actual unmodified Dashboard and StudentReport functions
from the page module in memory. It renders those views, the group editor, the
chart plots, and the real preference store logic. The Firestore stand-in
supports only synthetic private favorites, audience indexes, shared details and
classroom group paths. Storage events deliver changes across tabs. The stand-in
rejects cross-account private reads and staff reads of the admin index;
it is not a substitute for Firestore rules/emulator tests. Production routes do not
import this directory. This is component integration in Chromium, not a test
of login, navigation, Firestore rules, server synchronization, or physical devices.

The base fixture has three synthetic students, three rooms, two grades, three
sections, two scored years and one roster-only year. The picker variant adds a
second field, two teams and shuffled rooms from grades 3 through 11; the dense
variant has 12 windows per year. The duplicates variant gives two IDs the same
name; `missingRecall` leaves the second student's latest Spring Recall blank.
Expected scores are calculated independently
of the app, including legitimate zeroes and empty intersections.

- `dashboard.pw.cjs`: All Students window averages, explicit students' lines
  matched to legends and window ticks, duplicate names selected by ID, changes
  to rooms and selection, aggregate Comparison and Average charts, classroom group and favorite
  management, full available panel width on a 1920px desktop, confined mobile
  plot scrolling, fullscreen labels, and PDFs rendered with Poppler.
- `pickers.pw.cjs`: all nine searchable filters, no results, clearing,
  keyboard selection, natural room order, and selection across searches.
- `report.pw.cjs`: save real Dashboard favorites, select more than one in the
  report, vary students and years, reload, switch accounts without remounting,
  withdraw a student, and reject a cached snapshot followed by denial. The
  Saved Charts checks use ordinary pointer clicks on checkbox inputs. Narrow
  layouts also check viewport bounds and attach the open menu screenshot.
- `report.pw.cjs` also downloads Excel files with two selected charts, one
  selected but empty chart, and no selected charts. `workbook.cjs` follows
  worksheet/drawing/chart relationships and checks chart caches against their
  backing cells. Assertions cover names, series, categories, values, and the
  absence of unselected charts and out-of-scope report rows. A same-name pair
  is exported together and narrowed to one; both the visible plot and native
  workbook series must retain the correct zero and missing values. The
  `multi-year-progression.xlsx` UI download exercises native Year / Window /
  Section categories across two years; every chart cache level is checked
  against the corresponding worksheet column before expanding grouped labels.
- `sharing.pw.cjs`: private by default, Admin vs All for a second user,
  read-only Dashboard use, scoped Student Report rendering, and live
  withdrawal on unshare and deletion.

The dedicated runner discovers the local `*.pw.cjs` suite and the existing
`e2e/dashboard-chart-layout.spec.cjs` regressions only. Workbooks, PDFs and Poppler-rendered
pages are generated under `.tmp/dashboard-ui/results` unless overridden
with Playwright's `--output`. Do not use real student records as fixtures.
