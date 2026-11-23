const { before, after, beforeEach, afterEach, test } = require("node:test");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const { build } = require("../verification/dashboard-ui/bundler.cjs");

// Exercise the actual pickers and both stylesheets without a server or a school account.
const fixture = `
  import { useState } from "react";
  import { createRoot } from "react-dom/client";
  import "./app/globals.css";
  import { DashboardChoicePicker } from "./components/dashboard-choice-picker";
  import { DashboardFilterPicker } from "./components/dashboard-filter-picker";
  const options = ["Alpha", "Beta", "Gamma", ...Array.from({ length: 40 }, (_, i) => "Other " + i)]
    .map((label, i) => ({ label, id: String(i) }));
  function Fixture() {
    const [choice, setChoice] = useState("0");
    const [fields, setFields] = useState(["0"]);
    const [rooms, setRooms] = useState([]);
    const [auto, setAuto] = useState(true);
    const [years, setYears] = useState(["1"]);
    return <><button>Outside</button><div>Non-focusable outside</div><div className="dashboard-filters">
      <DashboardChoicePicker label="Assessment" options={options} value={choice} onChange={setChoice} />
      <DashboardFilterPicker label="Fields" allLabel="All fields" options={options} selected={fields} onChange={setFields} />
      <DashboardFilterPicker label="Rooms" allLabel="All rooms" options={options} selected={rooms} onChange={setRooms} emptyMeansAll />
      <DashboardFilterPicker label="Years" allLabel="All years" options={options} selected={years}
        automatic={auto} onAutomatic={() => { setAuto(true); setYears(["1"]); }}
        onChange={ids => { setAuto(false); setYears(ids); }} />
    </div></>;
  }
  createRoot(document.getElementById("root")).render(<Fixture />);
`;

let browser, page, assets;
before(async () => {
  const root = path.resolve(__dirname, "..");
  assets = (await build({
    absWorkingDir: root, stdin: { contents: fixture, loader: "tsx", resolveDir: root },
    bundle: true, jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
    write: false, outfile: "fixture.js"
  })).outputFiles;
  browser = await chromium.launch();
});
beforeEach(async () => {
  page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: assets.find(f => f.path.endsWith(".css")).text });
  await page.addScriptTag({ content: assets.find(f => f.path.endsWith(".js")).text });
});
afterEach(async () => { await page?.close(); });
after(async () => { await browser?.close(); });

function trigger(name) { return page.getByRole("button", { name, exact: true }); }
function search() { return page.getByRole("searchbox"); }
function check(name) { return page.getByRole("checkbox", { name, exact: true }); }

test("single choice: search and clear preserve selection; keyboard selects and restores focus", async () => {
  const assessment = trigger("Assessment");
  await assessment.press("Enter");
  await expect(search()).toBeFocused();
  await search().fill("  bEt  ");
  await expect(page.getByRole("radio")).toHaveCount(1);
  await expect(page.getByRole("radio", { name: "Beta" })).not.toBeChecked();
  await search().fill("no match");
  await expect(page.getByRole("status")).toHaveText("No results");
  await expect(trigger("Focus Assessment search")).toBeVisible();
  await trigger("Clear Assessment search").press("Enter");
  await expect(search()).toBeFocused();
  await expect(page.getByRole("radio", { name: "Alpha" })).toBeChecked();
  await search().fill("bEt");
  await search().press("ArrowDown");
  const beta = page.getByRole("radio", { name: "Beta" });
  await expect(beta).toBeFocused();
  await beta.press("Enter");
  await expect(assessment).toHaveText("Beta");
  await expect(assessment).toBeFocused();
  await assessment.press("Space");
  await expect(search()).toHaveValue("");
  await expect(page.getByRole("radio", { name: "Beta" })).toBeChecked();
});

test("multi: hidden selections survive toggles and clears; bulk action uses the entire list", async () => {
  const fields = trigger(/^Fields:/);
  await fields.click();
  await search().fill("gAM");
  await search().press("ArrowUp");
  await expect(check("Gamma")).toBeFocused();
  await check("Gamma").press("Space");
  await expect(check("Gamma")).toBeChecked();
  await expect(fields).toHaveText("2 fields");
  await trigger("Clear Fields search").click();
  await expect(check("Alpha")).toBeChecked();
  await expect(check("Gamma")).toBeChecked();
  await check("Gamma").uncheck();
  await check("Alpha").click();
  await expect(check("Alpha")).toBeChecked(); // Fields cannot drop the last individual selection.
  await search().fill("all fi");
  await check("All fields").check();
  await trigger("Clear Fields search").click();
  await expect(check("Other 39")).toBeChecked();
  await expect(check("Alpha")).toBeChecked();
  await check("All fields").uncheck();
  await expect(check("Alpha")).not.toBeChecked();
  await search().fill("absent");
  await search().press("Escape");
  await expect(fields).toBeFocused();
  await fields.click();
  await expect(search()).toHaveValue("");
});

test("empty-means-all and automatic-years modes keep their selection semantics", async () => {
  await trigger(/^Rooms:/).click();
  await expect(check("All rooms")).toBeChecked();
  await search().fill("alp");
  await check("Alpha").check();
  await check("Alpha").uncheck();
  await expect(trigger(/^Rooms:/)).toHaveText("All rooms");
  await trigger(/^Years:/).click();
  await search().fill("missing");
  await expect(page.getByRole("status")).toHaveText("No results");
  await expect(trigger(/^Years:/)).toHaveText("Auto (1)");
  await search().fill("alp");
  await check("Alpha").check();
  await expect(trigger(/^Years:/)).toHaveText("2 years");
  await trigger("Clear Years search").click();
  await expect(check("Beta")).toBeChecked();
  await search().fill("AUTOMATIC");
  await check("Automatic (years with data)").check();
  await expect(trigger(/^Years:/)).toHaveText("Auto (1)");
});

test("dismissal: outside click keeps outside focus; close and Escape return to trigger", async () => {
  for (const name of ["Assessment", /^Fields:/]) {
    const opener = trigger(name);
    const dialog = page.getByRole("dialog");
    await opener.click();
    await trigger("Outside").click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger("Outside")).toBeFocused();
    await opener.click();
    await page.getByText("Non-focusable outside", { exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await opener.click();
    await dialog.getByRole("button", { name: /^Close / }).click();
    await expect(opener).toBeFocused();
    await opener.click();
    await search().press("Escape");
    await expect(opener).toBeFocused();
    await opener.click();
    await search().press("Shift+Tab");
    await expect(opener).toBeFocused();
    await opener.press("Shift+Tab");
    await expect(dialog).toHaveCount(0);
  }
});

test("search and close stay beside each other and usable when a long menu scrolls", async () => {
  await page.setViewportSize({ width: 375, height: 700 });
  for (const name of ["Assessment", /^Fields:/]) {
    await trigger(name).click();
    const dialog = page.getByRole("dialog");
    const focusSearch = dialog.getByRole("button", { name: /^Focus / });
    const close = dialog.getByRole("button", { name: /^Close / });
    const before = await focusSearch.boundingBox();
    const last = dialog.getByLabel("Other 39", { exact: true });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    const iconBox = await focusSearch.boundingBox();
    const closeBox = await close.boundingBox();
    expect(iconBox.y).toBe(before.y);
    expect(closeBox.y).toBe(iconBox.y);
    expect(closeBox.x).toBeGreaterThanOrEqual(iconBox.x + iconBox.width);
    await focusSearch.click();
    await expect(search()).toBeFocused();
    await close.click();
  }
});
