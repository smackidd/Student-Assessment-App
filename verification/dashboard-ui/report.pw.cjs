const { test, expect, origin } = require("./browser.cjs");
const { inspectWorkbook } = require("./workbook.cjs");
const { byButton, cards, sortedScores, recall, recallWindows, expectProgression, choice, subset, rooms, sections, years,
  favorites, saveFavorite, selectStudents } = require("./actions.cjs");

const savedCharts = page => byButton(page, "Saved Charts");
const picker = page => page.getByRole("group", { name: "Saved Charts", exact: true });
const option = (root, name) => root.getByRole("checkbox", { name, exact: true });
const rendered = page => page.locator(".report-preview [data-report-chart]");
const chart = (page, name) => rendered(page).filter({ has: page.getByRole("heading", { name, exact: true }) });
async function clickSavedChart(page, name, checked) {
  const input = option(picker(page), name);
  await expect(input).toBeChecked({ checked: !checked });
  await input.scrollIntoViewIfNeeded();
  const hit = await input.evaluate(el => {
    const r = el.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const target = document.elementFromPoint(x, y);
    return { x, y, target: target === el ? "checkbox" : target?.outerHTML.slice(0, 180) ?? "outside viewport" };
  });
  expect.soft(hit.target, name + " checkbox center at " + hit.x + "," + hit.y).toBe("checkbox");
  await input.click();
  await expect(input).toBeChecked({ checked });
}
async function addStudent(page, name) {
  await page.getByRole("combobox", { name: "Find students" }).fill(name);
  await page.getByRole("option", { name: new RegExp(name + " Example") }).click();
}
async function saveFromDashboard(page, name, configure, query = "") {
  await page.goto(origin + "/" + query);
  const card = cards(page).first();
  await configure(card);
  await favorites(card);
  await saveFavorite(card, name);
}
async function assertScores(page, name, scores) {
  const block = chart(page, name);
  await expect(block).toHaveCount(1);
  if (!scores.length) {
    await expect(block.getByText(/^No values match\b/i)).toBeVisible();
  }
  await expect.poll(() => sortedScores(block)).toEqual(scores);
}

async function downloadWorkbook(page, info, name, options) {
  const [download] = await Promise.all([page.waitForEvent("download"), byButton(page, "Download Excel report").click()]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);
  const file = info.outputPath(name + ".xlsx");
  await download.saveAs(file);
  return inspectWorkbook(file, options);
}

test("Excel graphs only selected saved charts at the report's student and year intersection", async ({ page }, info) => {
  const pair = "Pair recall", bars = "Transfer bars", ignored = "Unselected diagnostic";
  await saveFromDashboard(page, pair, async card => {
    await selectStudents(card, "Ada Example", "Cy Example");
    await subset(card, "Sections", sections, ["Recall"]);
    await subset(card, "Years", years, [years[2]]);
  });
  await saveFromDashboard(page, bars, async card => {
    await choice(card, "Chart type", "Comparison");
    await choice(card, "Window", "Spring");
    await subset(card, "Sections", sections, ["Transfer"]);
  });
  await saveFromDashboard(page, ignored, card => choice(card, "Window", "Fall"));
  await page.goto(origin + "/?report");
  await addStudent(page, "Ben");
  await option(page, years[0]).uncheck();
  await savedCharts(page).click();
  await clickSavedChart(page, bars, true);
  await clickSavedChart(page, pair, true);
  await expect(option(picker(page), ignored)).not.toBeChecked();
  await byButton(picker(page), "Close Saved Charts").click();
  // Both scored years are still on the report; only the favorite's latest year may appear.
  await addStudent(page, "Cy");
  await expectProgression(chart(page, pair), recallWindows, { ["Ada Example / " + recall]: [0, 3], ["Cy Example / " + recall]: [80, 83] });
  await page.getByRole("button", { name: /^Remove Cy Example,/ }).click();
  await option(page, years[1]).uncheck();
  await assertScores(page, pair, [0, 3]); // Ada alone is in both groups; Ben and Cy must not contribute.
  const withCharts = await downloadWorkbook(page, info, "selected-charts");
  expect([...withCharts.sheets].sort()).toEqual(["Student Report", pair, bars].sort());
  const label = (window, section) => [years[2], window, section].join(" \u00b7 ");
  expect(withCharts.charts).toEqual([
    { title: pair, series: [{ type: "lineChart", name: "Ada Example / " + recall,
      categories: [label("Fall", "Recall"), label("Spring", "Recall")], values: [0, 3] }] },
    { title: bars, series: [{ type: "barChart", name: "Diagnostic score / Transfer",
      categories: [label("Spring", "Transfer")], values: [15] }] }
  ]);
  const reportRows = withCharts.report.flat().join(" ");
  expect(reportRows).toContain("Ada Example");
  expect(reportRows).toContain("Ben Example");
  expect(reportRows).not.toContain("Cy Example");
  expect(reportRows).not.toContain(years[1]);
  await savedCharts(page).click();
  await clickSavedChart(page, bars, false);
  await byButton(picker(page), "Close Saved Charts").click();
  await page.getByRole("button", { name: /^Remove Ada Example,/ }).click();
  await assertScores(page, pair, []);
  const empty = await downloadWorkbook(page, info, "empty-intersection");
  expect(empty.sheets).toEqual(["Student Report", pair]);
  expect(empty.charts.every(c => c.title === pair)).toBe(true);
  const emptyCells = empty.rows[pair].flat();
  expect(emptyCells.join(" ")).toMatch(/no (matching |chart )?(values|data)/i);
  expect(emptyCells.filter(v => typeof v === "number")).toEqual([]);
  expect(empty.charts.flatMap(c => c.series.flatMap(s => s.values.filter(v => v != null)))).toEqual([]);
  await addStudent(page, "Ada");
  await savedCharts(page).click();
  await clickSavedChart(page, pair, false);
  await byButton(picker(page), "Close Saved Charts").click();
  await expect(rendered(page)).toHaveCount(0);
  const plain = await downloadWorkbook(page, info, "no-charts");
  expect(plain.charts).toEqual([]);
  expect(plain.sheets).toEqual(["Student Report"]);
  expect(plain.report.flat().join(" ")).toContain("Ben Example");
  expect(plain.report.flat().join(" ")).toContain("Ada Example");
});

test("same-name saved Progression preserves scoped legends, zero and blank in preview and Excel", async ({ page }, info) => {
  const name = "Independent recall", variant = "?duplicates&missingRecall";
  const first = "Ada Example (synthetic-0)", second = "Ada Example (synthetic-1)";
  await saveFromDashboard(page, name, async card => {
    await selectStudents(card, first, second);
    await subset(card, "Sections", sections, ["Recall"]);
    await subset(card, "Years", years, [years[2]]);
  }, variant);
  await page.goto(origin + "/" + variant + "&report");
  await addStudent(page, "Ada");
  await savedCharts(page).click();
  await clickSavedChart(page, name, true);
  await byButton(picker(page), "Close Saved Charts").click();
  async function assertPreviewAndWorkbook(file, series) {
    await expectProgression(chart(page, name), recallWindows, series);
    const workbook = await downloadWorkbook(page, info, file);
    expect(workbook.sheets).toEqual(["Student Report", name]);
    expect(workbook.charts.map(c => c.title)).toEqual([name]);
    expect(workbook.charts[0].series.slice().sort((a, b) => a.name.localeCompare(b.name))).toEqual(
      Object.entries(series).sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) =>
        ({ type: "lineChart", name, categories: recallWindows, values })));
    return workbook;
  }
  await assertPreviewAndWorkbook("same-name-pair", { [first + " / " + recall]: [0, 3], [second + " / " + recall]: [20, null] });
  await page.getByRole("button", { name: /^Remove Ada Example,.*3A/ }).click();
  const one = await assertPreviewAndWorkbook("same-name-narrowed", { ["Ada Example / " + recall]: [20, null] });
  expect(one.rows[name].flat().join(" ")).not.toContain("synthetic-0");
});

test("multi-year Progression keeps students and sections separate under grouped Excel categories", async ({ page }, info) => {
  const name = "Multi-year progression";
  await saveFromDashboard(page, name, async card => {
    await selectStudents(card, "Ada Example", "Cy Example");
    await subset(card, "Sections", sections, ["Recall", "Transfer"]);
    await subset(card, "Years", years, years.slice(1));
  });
  await page.goto(origin + "/?report");
  await addStudent(page, "Cy");
  await savedCharts(page).click();
  await clickSavedChart(page, name, true);
  await byButton(picker(page), "Close Saved Charts").click();
  const categories = years.slice(1).flatMap(year => ["Fall", "Spring"].flatMap(window =>
    ["Recall", "Transfer"].map(section => [year, window, section].join(" \u00b7 "))));
  const series = {
    ["Ada Example / " + recall]: [10, null, 13, null, 0, null, 3, null],
    "Ada Example / Diagnostic score / Transfer": [null, 12, null, 15, null, 2, null, 5],
    ["Cy Example / " + recall]: [90, null, 93, null, 80, null, 83, null],
    "Cy Example / Diagnostic score / Transfer": [null, 92, null, 95, null, 82, null, 85]
  };
  await expectProgression(chart(page, name), categories, series);
  const workbook = await downloadWorkbook(page, info, "multi-year-progression", { categoryLevelNames: ["Year", "Window", "Section"] });
  expect(workbook.sheets).toEqual(["Student Report", name]);
  expect(workbook.charts).toHaveLength(1);
  const exported = workbook.charts[0];
  expect(exported.title).toBe(name);
  expect(exported.series).toHaveLength(4);
  for (const item of exported.series) {
    expect(item.type).toBe("lineChart");
    expect(item.categories).toEqual(categories);
  }
  expect(Object.fromEntries(exported.series.map(s => [s.name, s.values]))).toEqual(series);
});

test("two Dashboard favorites intersect independently with report students and years", async ({ page }) => {
  const pair = "Paired rooms fall recall", single = "Ben spring transfer";
  await saveFromDashboard(page, pair, async card => {
    await subset(card, "Home rooms", rooms, ["3A", "3B"]);
    await choice(card, "Window", "Fall");
    await subset(card, "Sections", sections, ["Recall"]);
    await subset(card, "Years", years, [years[1]]);
  });
  await saveFromDashboard(page, single, async card => {
    await selectStudents(card, "Ben Example");
    await choice(card, "Window", "Spring");
    await subset(card, "Sections", sections, ["Transfer"]);
  });
  await page.goto(origin + "/?report");
  await expect(page.getByText("Favorites", { exact: true })).toHaveCount(0);
  await expect(rendered(page)).toHaveCount(0);
  await savedCharts(page).click();
  for (const name of [single, pair]) await clickSavedChart(page, name, true);
  await byButton(picker(page), "Close Saved Charts").click();
  await expect(savedCharts(page)).toContainText("2 charts");
  await assertScores(page, pair, [10]);
  await assertScores(page, single, []);
  await page.reload();
  await expect(rendered(page)).toHaveCount(2);
  await assertScores(page, pair, [10]);

  await addStudent(page, "Ben");
  await assertScores(page, pair, [20]);
  await assertScores(page, single, [25, 35]);
  await addStudent(page, "Cy");
  await assertScores(page, pair, [20]); // Cy is selected on the report but not in either saved room.
  await assertScores(page, single, [25, 35]);
  await page.getByRole("button", { name: /^Remove Ada Example,/ }).click();
  await assertScores(page, pair, [30]);
  await option(page, years[1]).uncheck();
  await assertScores(page, pair, []);
  await assertScores(page, single, [25]);
  await expect(chart(page, single).locator("[data-year-band]")).toHaveAttribute("data-year-band", years[2]);
  await page.getByRole("button", { name: /^Remove Ben Example,/ }).click();
  await assertScores(page, single, []);
  await expect(page.locator(".report-preview")).not.toContainText("Ben Example");
  await savedCharts(page).click();
  await clickSavedChart(page, pair, false);
  await expect(rendered(page)).toHaveCount(1);
  await expect(chart(page, single)).toHaveCount(1);
  await clickSavedChart(page, single, false);
  await expect(rendered(page)).toHaveCount(0);
  await expect(page.locator(".report-preview")).toContainText("Cy Example");
});

test("saved chart names and selections stay private across account changes and unavailable inputs", async ({ page }) => {
  const first = "Private reading trend", second = "My second-account chart";
  await saveFromDashboard(page, first, card => selectStudents(card, "Ada Example"));
  await saveFromDashboard(page, second, card => selectStudents(card, "Ben Example"), "?account=second");
  await page.goto(origin + "/?report&switchable");
  await savedCharts(page).click();
  await expect(option(picker(page), second)).toHaveCount(0);
  await clickSavedChart(page, first, true);
  await byButton(picker(page), "Close Saved Charts").click();
  await assertScores(page, first, [0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14, 15]);
  await byButton(page, "Switch fixture account").click();
  await expect(rendered(page)).toHaveCount(0);
  await savedCharts(page).click();
  await expect(option(picker(page), second)).not.toBeChecked();
  await expect(page.getByText(first, { exact: true })).toHaveCount(0);
  await clickSavedChart(page, second, true);
  await expect(chart(page, second)).toHaveCount(1);
  await page.goto(origin + "/?report&restricted");
  await savedCharts(page).click();
  await expect(option(picker(page), first + " (unavailable)")).toBeDisabled();
  await expect(rendered(page)).toHaveCount(0);
  await expect(page.locator(".report-preview")).not.toContainText("Ada Example");
  await page.goto(origin + "/?report&denyFavorites");
  await savedCharts(page).click();
  await expect(picker(page).getByRole("status")).toContainText("Loading saved charts");
  await expect(page.getByText(first, { exact: true })).toHaveCount(0);
  await expect(rendered(page)).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("fixture:deny-favorites")));
  await expect(picker(page).getByRole("alert")).toContainText("could not be loaded");
  await expect(page.getByText(first, { exact: true })).toHaveCount(0);
  await expect(rendered(page)).toHaveCount(0);
});

for (const width of [1120, 390, 320]) {
  test("Saved Charts checkboxes receive pointer clicks beside the sidebar at " + width + "px", async ({ page }, info) => {
    const name = "Fall reading score";
    await saveFromDashboard(page, name, card => choice(card, "Window", "Fall"));
    await page.setViewportSize({ width, height: 844 });
    await byButton(page.getByRole("navigation"), "Student Report").click();
    await savedCharts(page).click();
    await expect(picker(page)).toHaveClass(/\bmulti-picker-menu\b/);
    await expect(picker(page)).toHaveClass(/\bwide\b/);
    const box = await picker(page).boundingBox(), side = await page.locator(".sidebar").boundingBox();
    const screenshot = info.outputPath("open-saved-charts.png");
    await page.screenshot({ path: screenshot });
    await info.attach("open-saved-charts", { path: screenshot, contentType: "image/png" });
    expect.soft(box.x, "menu left edge").toBeGreaterThanOrEqual(0);
    expect.soft(box.x + box.width, "menu right edge").toBeLessThanOrEqual(width);
    if (width > 1100) expect.soft(box.x, "menu may not extend behind the sidebar").toBeGreaterThanOrEqual(side.x + side.width);
    await clickSavedChart(page, name, true);
    await byButton(picker(page), "Close Saved Charts").click();
    await assertScores(page, name, [0, 1, 2, 10, 11, 12]);
    if (width <= 390) {
      const graph = chart(page, name).getByRole("region", { name: /scrollable graph/ });
      const bounds = await graph.boundingBox();
      expect.soft(bounds.x, "report graph left edge").toBeGreaterThanOrEqual(0);
      expect.soft(bounds.x + bounds.width, "report graph right edge").toBeLessThanOrEqual(width);
      expect(await graph.evaluate(el => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
    }
    await savedCharts(page).click();
    await clickSavedChart(page, name, false);
    await expect(rendered(page)).toHaveCount(0);
  });
}
