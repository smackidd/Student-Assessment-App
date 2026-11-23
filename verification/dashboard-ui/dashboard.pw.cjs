const { test, expect, origin } = require("./browser.cjs");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const { byButton, cards, pointValues, sortedScores, recall, recallWindows, expectProgression, control, choice, subset,
  rooms, sections, years, favorites, saveFavorite, studentMenu, studentTrigger, selectStudents } = require("./actions.cjs");

test("selected rooms and sections drive exact plotted scores and data-bearing years", async ({ page }) => {
  await page.goto(origin);
  const card = cards(page).first();
  await expect(card.locator("[data-year-band]")).toHaveCount(2);
  await subset(card, "Home rooms", rooms, ["3A","3B"]);
  await subset(card, "Sections", sections, ["Recall","Transfer"]);
  await expect(card.getByRole("list", { name: "Chart legend" }).getByRole("listitem")).toHaveText([
    "Diagnostic score / Recall", "Diagnostic score / Transfer"
  ]);
  await expect.poll(() => sortedScores(card)).toEqual([10,12,13,15,20,22,23,25]);
  await studentTrigger(card).click();
  await expect(studentMenu(card).getByRole("checkbox", { name: "Cy Example" })).toHaveCount(0);
  await studentMenu(card).getByRole("checkbox", { name: "Ada Example" }).check();
  await byButton(studentMenu(card), "Close Students").click();
  await choice(card, "Window", "Fall");
  await subset(card, "Sections", sections, ["Recall","Transfer"]);
  await expect.poll(() => sortedScores(card)).toEqual([0,2,10,12]);
  await subset(card, "Years", years, [years[0]]);
  await expect(card.getByText("No values match the selected filters.")).toBeVisible();
  await expect(byButton(card, "Download PDF")).toBeDisabled();
});

test("student searches preserve selections, room intersections, zero and all-student averages", async ({ page }) => {
  await page.goto(origin);
  const card = cards(page).first(), menu = studentMenu(card);
  const checked = name => menu.getByRole("checkbox", { name, exact: true });
  await subset(card, "Sections", sections, ["Recall"]);
  await subset(card, "Years", years, [years[2]]);
  const all = { [recall]: [33.3, 36.3] };
  const ada = { ["Ada Example / " + recall]: [0, 3] };
  const cy = { ["Cy Example / " + recall]: [80, 83] };
  const scores = expected => expectProgression(card, recallWindows, expected);
  await expect(card.getByRole("heading", { name: "Average field score by year and window" })).toBeVisible();
  await scores(all);
  await selectStudents(card, "Ada Example", "Cy Example");
  await expect(card.getByRole("heading", { name: "Student scores by year and window" })).toBeVisible();
  await scores({ ...ada, ...cy });
  await expect(card.locator(".recharts-line-curve")).toHaveCount(2);
  await studentTrigger(card).click();
  await expect(checked("Ada Example")).toBeChecked();
  await expect(checked("Cy Example")).toBeChecked();
  await expect(checked("Ben Example")).not.toBeChecked();
  await checked("Cy Example").uncheck();
  await scores(ada);
  await checked("All students").check();
  await scores(all);
  await byButton(menu, "Close Students").click();
  await selectStudents(card, "Ada Example", "Cy Example");
  await subset(card, "Home rooms", rooms, ["3B"]);
  await expect(card.getByText("No values match the selected filters.")).toBeVisible();
  await expect(pointValues(card)).toHaveCount(0);
  await subset(card, "Home rooms", rooms, ["7C"]);
  await scores(cy);
  await subset(card, "Home rooms", rooms, []);
  await scores({ ...ada, ...cy });
});

test("two students with the same display name remain independently selectable", async ({ page }) => {
  await page.goto(origin + "/?duplicates");
  const card = cards(page).first(), menu = studentMenu(card);
  await subset(card, "Sections", sections, ["Recall"]);
  await subset(card, "Years", years, [years[2]]);
  await studentTrigger(card).click();
  const search = menu.getByRole("searchbox");
  const expected = {};
  for (const [id, scores] of [["synthetic-1", [20, 23]], ["synthetic-0", [0, 3]]]) {
    await search.fill(id);
    const label = "Ada Example (" + id + ")";
    const match = menu.getByRole("checkbox", { name: label, exact: true });
    await expect(match).toHaveCount(1);
    await match.check();
    expected[label + " / " + recall] = scores;
    await expectProgression(card, recallWindows, expected);
  }
  await menu.getByRole("checkbox", { name: "Ada Example (synthetic-0)", exact: true }).uncheck();
  await expectProgression(card, recallWindows, { ["Ada Example (synthetic-1) / " + recall]: [20, 23] });
});

test("Comparison and Average aggregate the explicit student pair", async ({ page }) => {
  await page.goto(origin);
  const card = cards(page).first();
  await selectStudents(card, "Ada Example", "Cy Example");
  await subset(card, "Sections", sections, ["Recall"]);
  await subset(card, "Years", years, [years[2]]);
  const legend = card.getByRole("list", { name: "Chart legend" }).getByRole("listitem");
  await choice(card, "Chart type", "Comparison");
  await expect(legend).toHaveText([recall]);
  await expect(card.locator("[data-axis-tick] title")).toHaveText(recallWindows);
  await expect(card.locator(".recharts-label-list text")).toHaveText(["40", "43"]);
  await choice(card, "Chart type", "Average");
  await expect(legend).toHaveText([recall]);
  await expect(card.locator(".recharts-pie-sector")).toHaveCount(1);
  await expect(card.locator(".recharts-pie-label-text")).toHaveText("41.5");
});

test("groups can be created, used as a grade filter, edited and deleted through the normal panels", async ({ page }) => {
  await page.goto(origin + "/?groups");
  const panel = page.getByRole("region", { name: "Classroom Groups" });
  await byButton(panel, "Add group").click();
  await panel.getByLabel("Group name").fill("Practice cohort");
  await byButton(panel, "Save group").click();
  await expect(panel.getByRole("alert")).toContainText("grades");
  await panel.getByRole("checkbox", { name: "7", exact: true }).check();
  await byButton(panel, "Save group").click();
  await expect(panel.getByRole("status")).toHaveText("Created Practice cohort.");
  const card = cards(page).first();
  await choice(card, "Team", "Practice cohort");
  await studentTrigger(card).click();
  await expect(studentMenu(card).getByRole("checkbox")).toHaveCount(2);
  await expect(studentMenu(card).getByRole("checkbox", { name: "Cy Example" })).toBeVisible();
  await byButton(card, "Close Students").click();
  await byButton(panel, "Edit Practice cohort").click();
  await panel.getByRole("checkbox", { name: "3", exact: true }).check();
  await panel.getByRole("checkbox", { name: "7", exact: true }).uncheck();
  await byButton(panel, "Save group").click();
  await expect(panel.getByRole("status")).toHaveText("Updated Practice cohort.");
  await studentTrigger(card).click();
  await expect(studentMenu(card).getByRole("checkbox")).toHaveCount(3);
  await expect(studentMenu(card).getByRole("checkbox", { name: "Cy Example" })).toHaveCount(0);
  await byButton(card, "Close Students").click();
  await byButton(panel, "Delete Practice cohort").click();
  await byButton(panel, "Cancel").click();
  await expect(byButton(panel, "Edit Practice cohort")).toBeVisible();
  await byButton(panel, "Delete Practice cohort").click();
  await byButton(panel, "Delete group").click();
  await expect(panel.getByRole("status")).toHaveText("Deleted Practice cohort.");
  await control(card, "Team").click();
  await expect(card.getByRole("radio", { name: "Practice cohort" })).toHaveCount(0);
});

test("dashboard favorites restore filters across reload, update and delete", async ({ page }) => {
  await page.goto(origin);
  const card = cards(page).first();
  await subset(card, "Home rooms", rooms, ["3A","3B"]);
  await subset(card, "Sections", sections, ["Recall","Transfer"]);
  await favorites(card);
  await saveFavorite(card, "Paired rooms");
  await page.reload();
  await favorites(card);
  await card.getByLabel("Saved favorite").selectOption({ label: "Paired rooms" });
  await byButton(card, "Apply").click();
  await expect.poll(() => sortedScores(card)).toEqual([10,12,13,15,20,22,23,25]);
  await choice(card, "Chart type", "Comparison");
  await card.getByLabel("Favorite name").fill("Bars");
  await byButton(card, "Update favorite").click();
  await expect(card.getByRole("status")).toHaveText("Favorite updated.");
  await choice(card, "Chart type", "Average");
  await byButton(card, "Apply").click();
  await expect(control(card, "Chart type")).toContainText("Comparison");
  await page.goto(origin);
  await favorites(card);
  await card.getByLabel("Saved favorite").selectOption({ label: "Bars" });
  await byButton(card, "Delete").click();
  await byButton(card, "Confirm delete").click();
  await expect(card.getByLabel("Saved favorite").locator("option")).toHaveText(["New favorite"]);
});

test("chart cards keep independent chart types when added and removed", async ({ page }) => {
  await page.goto(origin);
  const first = cards(page).first();
  await byButton(first, "Add chart").click();
  await expect(cards(page)).toHaveCount(2);
  const second = cards(page).nth(1);
  await choice(second, "Chart type", "Average");
  await expect(second.locator(".recharts-pie-sector").first()).toBeVisible();
  await expect(control(first, "Chart type")).toContainText("Progression");
  await byButton(second, "Remove chart 2").click();
  await expect(cards(page)).toHaveCount(1);
});

test("fullscreen labels fit their SVG and a real chart PDF downloads and renders", async ({ page }, info) => {
  await page.goto(origin);
  const first = cards(page).first();
  await byButton(first, "Full screen").click();
  await expect(first.locator(".chart-panel-fullscreen")).toBeVisible();
  await expect(pointValues(first)).toHaveCount(12);
  await expect(first.locator("[data-year-band]")).toHaveCount(2);
  const clipped = await pointValues(first).evaluateAll(nodes => nodes.filter(node => {
    const a = node.getBoundingClientRect(), s = node.ownerSVGElement.getBoundingClientRect();
    return a.width <= 0 || a.height <= 0 || a.left < s.left || a.top < s.top || a.right > s.right || a.bottom > s.bottom;
  }).length);
  expect(clipped).toBe(0);
  await page.keyboard.press("Escape");
  await expect(first.locator(".chart-panel-fullscreen")).toHaveCount(0);
  const download = page.waitForEvent("download");
  await byButton(first, "Download PDF").click();
  const pdf = await download;
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/i);
  const file = info.outputPath("progression.pdf");
  await pdf.saveAs(file);
  expect((await fs.readFile(file)).subarray(0, 5).toString()).toBe("%PDF-");
  const details = execFileSync("pdfinfo", [file], { encoding: "utf8" });
  expect(details).toMatch(/Pages:\s+[1-9]/);
  execFileSync("pdftoppm", ["-png","-r","85",file,info.outputPath("page")]);
});

test("a single chart fills the available desktop panel width past 1400px", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(origin);
  const card = cards(page).first();
  await expect(pointValues(card)).toHaveCount(12);
  const plot = card.locator(".chart-panel");
  const header = await page.locator(".workspace > .topbar").boundingBox();
  expect(header.width).toBeGreaterThan(1400);
  for (const element of [card.locator(".dashboard-filters"), plot]) {
    const box = await element.boundingBox();
    expect(Math.abs(box.x - header.x)).toBeLessThanOrEqual(2);
    // Allow the layout's scrollbar/gutter, not a fixed-width chart or wrapper.
    expect(Math.abs(header.x + header.width - box.x - box.width)).toBeLessThanOrEqual(24);
  }
  const svg = await plot.locator("svg.recharts-surface").boundingBox();
  const viewport = await plot.getByRole("region", { name: /scrollable graph/ }).boundingBox();
  expect(viewport.width).toBeGreaterThan(1400);
  expect(Math.abs(svg.width - viewport.width)).toBeLessThanOrEqual(2);
});

test("a dense plot scrolls on a narrow viewport and exports beyond the visible windows", async ({ page }, info) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/?dense");
  const card = cards(page).first();
  const viewport = card.getByRole("region", { name: /scrollable graph/ });
  await expect(card.locator("[data-axis-tick]")).toHaveCount(72);
  await expect(pointValues(card)).toHaveCount(72);
  const size = await viewport.evaluate(el => ({ width: el.clientWidth, content: el.scrollWidth }));
  expect(size.width).toBeGreaterThan(180);
  expect(size.width).toBeLessThanOrEqual(390);
  expect(size.content).toBeGreaterThan(2000);
  for (const container of [page.locator("html"), page.locator(".workspace"), page.locator(".dashboard-layout"), card]) {
    const bounds = await container.evaluate(el => ({ left: el.getBoundingClientRect().left,
      right: el.getBoundingClientRect().right, overflow: el.scrollWidth - el.clientWidth }));
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(390);
    expect(bounds.overflow).toBeLessThanOrEqual(1);
  }
  await card.getByRole("button", { name: /^Years:/ }).click();
  const menu = card.getByRole("dialog", { name: "Years" });
  const menuBox = await menu.boundingBox();
  const filterBox = await card.locator(".dashboard-filters").boundingBox();
  expect(menuBox.x).toBeGreaterThanOrEqual(filterBox.x);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(filterBox.x + filterBox.width);
  await byButton(menu, "Close Years").click();
  await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeGreaterThan(1000);
  await expect(card.locator("[data-axis-tick]").last()).toContainText("Window 12");
  const started = Date.now();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 110000 }), byButton(card, "Download PDF").click()
  ]);
  const file = info.outputPath("dense.pdf");
  await download.saveAs(file);
  const details = execFileSync("pdfinfo", [file], { encoding: "utf8" });
  const pages = Number(details.match(/Pages:\s+(\d+)/)?.[1]);
  console.log("Dense chart export: %d pages in %d ms", pages, Date.now() - started);
  expect(pages).toBeGreaterThanOrEqual(3);
  execFileSync("pdftoppm", ["-png", "-r", "85", file, info.outputPath("dense")]);
});

test("a saved student favorite cannot restore a student absent from current inputs", async ({ page }) => {
  await page.goto(origin);
  const card = cards(page).first();
  await selectStudents(card, "Ada Example");
  await favorites(card);
  await saveFavorite(card, "Single learner");
  await page.goto(origin + "/?restricted");
  await favorites(card);
  await card.getByLabel("Saved favorite").selectOption({ label: "Single learner" });
  await byButton(card, "Apply").click();
  await expect(card.getByRole("status")).toContainText("no longer available");
  await expect(studentTrigger(card)).toContainText("All students");
});

for (const [mode, mark] of [["Comparison", ".recharts-bar-rectangle"], ["Average", ".recharts-pie-sector"]]) {
  test(mode + " has visible marks, legible legend entries and a readable chart PDF", async ({ page }, info) => {
    await page.goto(origin);
    const card = cards(page).first();
    await choice(card, "Chart type", mode);
    await expect(card.locator(mark).first()).toBeVisible();
    await expect(card.getByRole("list", { name: "Chart legend" }).getByRole("listitem")).toHaveText([
      "Diagnostic score / Recall", "Diagnostic score / Reasoning", "Diagnostic score / Transfer"
    ]);
    const [download] = await Promise.all([page.waitForEvent("download"), byButton(card, "Download PDF").click()]);
    const file = info.outputPath(mode + ".pdf");
    await download.saveAs(file);
    expect(execFileSync("pdfinfo", [file], { encoding: "utf8" })).toMatch(/Pages:\s+[1-9]/);
    execFileSync("pdftoppm", ["-png", "-r", "85", file, info.outputPath(mode)]);
  });
}
