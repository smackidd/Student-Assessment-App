// Mount the real report with synthetic rows and a read-only favorite subscription.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import bundler from "../verification/dashboard-ui/bundler.cjs";
import workbookQA from "../verification/dashboard-ui/workbook.cjs";
const { build } = bundler;

const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = `
import { createRoot } from "react-dom/client";
import { StudentReport } from "./app/page";
import { assessmentTemplates } from "./lib/assessment-templates";
import { assessmentValueKey } from "./lib/assessment-entry";
import { defaultDashboardFilters } from "./lib/dashboard-filters";
import { initialOrfRows } from "./lib/sample-results";
const template = assessmentTemplates.find(a => a.sections?.some(s => s.id === "irregular"));
const field = template.fields.find(f => f.id === "score"), section = template.sections.find(s => s.id === "regular");
const years = ["2025-2026","2024-2025"], round = template.rounds[0];
const rows = ["Alice","Bob"].map((student,i) => ({...initialOrfRows[0], id: student, student,
  assessmentValues: Object.fromEntries(years.map((schoolYear,j) => [
    assessmentValueKey(template, round, field, section, {schoolYear,grade:"3"}), 10 * i + j]))}));
const placements = rows.flatMap(r => years.map(schoolYear => ({studentId:r.id, schoolYear, grade:"3", homeroom:"A"})));
const classroomGroups = [{id:"grade-3",name:"Grade 3",grades:["3"]}];
const value = {...defaultDashboardFilters(template), fieldKeys:[template.id+"::score"], sectionIds:["regular"], roundId:round.id};
const { studentIds, ...legacyValue } = value;
window.items = [
  {id:"individual", name:"Alice only", value:{...legacyValue,studentKey:"Alice",years:[years[0]]}},
  {id:"cohort", name:"Room A", value:{...value,homerooms:["A"],teamId:"grade-3"}},
  {id:"stale", name:"Retired field", value:{...value,fieldKeys:["missing"]}}
];
const host = createRoot(document.getElementById("root"));
window.account = uid => host.render(<StudentReport key={uid} uid={uid} classroomGroups={classroomGroups} rows={rows} placements={placements}
  templates={[template]} schoolYears={years} recordAudit={() => ""}/>);
window.account("owner");
`;
const { outputFiles } = await build({ absWorkingDir: root, stdin: { contents: fixture, loader: "tsx", resolveDir: root },
  bundle: true, jsx: "automatic", write: false, outfile: "report.js", logLevel: "silent", minify: true,
  define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_FIREBASE_PROJECT_ID: "fixture" }),
    "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "report-fixture", setup(b) {
    b.onLoad({ filter: /[\\/]app[\\/]page\.tsx$/ }, async args => ({
      contents: await readFile(args.path, "utf8") + "\nexport { StudentReport };", loader: "tsx"
    }));
    b.onLoad({ filter: /[\\/]filter-favorite-store\.ts$/ }, () => ({
      contents: `export const createFavoriteStore = () => ({
        subscribe(uid, scope, next, failed) {
          if (scope !== "dashboard") throw Error("unexpected scope");
          window.subscribed = uid;
          window.publish = () => next(uid === "owner" ? window.items : []);
          window.deny = failed;
          return () => { window.subscribed = null };
        },
        write() { throw Error("unexpected favorite write"); }
      });`
    }));
  } }]
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).hostname !== "report.test") return route.abort();
    const asset = outputFiles.find(f => route.request().url().endsWith("/" + path.basename(f.path)));
    return route.fulfill(asset ? { body: Buffer.from(asset.contents), contentType: asset.path.endsWith(".css") ? "text/css" : "text/javascript" }
      : { contentType: "text/html", body: '<link rel="stylesheet" href="/report.css"><div id="root"></div><script src="/report.js"></script>' });
  });
  const ready = (uid) => page.waitForFunction(id => window.subscribed === id, uid);
  const picker = page.getByRole("button", { name: "Saved Charts", exact: true });
  const individual = page.locator('[data-report-chart="individual"]');
  const group = page.locator('[data-report-chart="cohort"]');
  const graphs = page.locator("[data-report-chart]");
  const check = name => page.getByRole("checkbox", { name, exact: true });
  await page.goto("http://report.test/");
  await ready("owner");
  await picker.click();
  await expect(page.getByRole("status")).toHaveText("Loading saved charts...");
  await page.evaluate(() => window.publish());
  await expect(check("Retired field (unavailable)")).toBeDisabled();
  await check("Alice only").check();
  await check("Room A").check();
  await expect(individual.locator("[data-point-value]")).toHaveText("0");
  await expect(group.locator("[data-point-value]")).toHaveText(["1", "0"]);
  await page.getByRole("button", { name: "Close Saved Charts" }).click();
  await page.getByRole("combobox").fill("Bob");
  await page.getByRole("combobox").press("Enter");
  await page.getByRole("button", { name: /^Remove Alice,/ }).click();
  await expect(individual).toContainText("No values match");
  await expect(group.locator("[data-point-value]")).toHaveText(["11", "10"]);
  await check("2024-2025").uncheck();
  await expect(group.locator("[data-point-value]")).toHaveText("10");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Excel report" }).click();
  const excel = await download;
  assert.match(excel.suggestedFilename(), /\.xlsx$/);
  const workbook = workbookQA.inspectWorkbook(await excel.path());
  assert.deepEqual([...workbook.sheets].sort(), ["Alice only", "Room A", "Student Report"]);
  assert.deepEqual(workbook.charts.find(c => c.title === "Room A")?.series.map(s => s.values), [[10]]);
  assert.match(workbook.rows["Alice only"].flat().join(" "), /no (matching |chart )?(values|data)/i);
  await expect(page.getByRole("button", { name: "Download PDF" })).toHaveCount(0);

  await page.reload();
  await ready("owner");
  await expect(graphs).toHaveCount(0);
  await page.evaluate(() => window.publish());
  await expect(graphs).toHaveCount(2);
  await page.evaluate(() => {
    window.items = window.items.filter(i => i.id !== "individual").map(i => ({...i, name:"Renamed " + i.name}));
    window.publish();
  });
  await expect(graphs).toHaveCount(1);
  await expect(group.getByRole("heading")).toHaveText("Renamed Room A");
  await page.evaluate(() => window.deny());
  await expect(graphs).toHaveCount(0);
  await picker.click();
  await expect(page.getByRole("alert")).toContainText("could not be loaded");
  await page.getByRole("button", { name: "Retry" }).click();
  await page.evaluate(() => window.publish());
  await expect(graphs).toHaveCount(1);
  await check("All saved charts").uncheck();
  await expect(graphs).toHaveCount(0);
  await check("All saved charts").check();
  await page.evaluate(() => window.account("other"));
  await ready("other");
  await page.evaluate(() => window.publish());
  await picker.click();
  await expect(page.getByText("No saved Dashboard charts.")).toBeVisible();
  await expect(graphs).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log("Passed Student Report chart selection, plotted scopes, reload, updates, deletion, denied access, retry, account isolation and XLSX download.");
} finally { await browser.close(); }
