const { test, expect, origin } = require("../verification/dashboard-ui/browser.cjs");
const { choice, favorites, saveFavorite } = require("../verification/dashboard-ui/actions.cjs");

const cardSelector = ".dashboard-chart-workspace";
const graph = card => card.getByRole("region", { name: /scrollable graph/ });

async function expectNoOuterOverflow(card) {
  expect(await card.evaluate(el => {
    const overflow = [];
    for (let node = el.querySelector(".chart-panel"); node; node = node.parentElement) {
      if (node.scrollWidth > node.clientWidth + 1) overflow.push(node.className || node.tagName);
    }
    return overflow;
  })).toEqual([]);
}

async function expectPanelFitsCard(card) {
  const panel = await card.locator(".chart-panel").boundingBox();
  const box = await card.boundingBox();
  expect(panel.x).toBeCloseTo(box.x, 0);
  expect(panel.width).toBeCloseTo(box.width, 0);
}

test("the plot uses the dashboard width inside the margins when the data fits", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(origin);
  const card = page.locator(cardSelector);
  await expect(graph(card).locator("svg.recharts-surface")).toBeVisible();
  const strip = await page.locator(".dashboard-chart-strip").boundingBox();
  const box = await card.boundingBox();
  expect(box.width).toBeGreaterThan(1000);
  expect(box.x).toBeGreaterThan(0);
  expect(box.x + box.width).toBeLessThan(1920);
  expect(box.width).toBeCloseTo(strip.width, 0);
  await expectPanelFitsCard(card);
  await expect.poll(() => graph(card).evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  await expectNoOuterOverflow(card);
});

test("an average chart fits a small phone without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(origin);
  const card = page.locator(cardSelector);
  await choice(card, "Chart type", "Average");
  await expect(graph(card).locator(".recharts-pie-sector").first()).toBeVisible();
  await expectPanelFitsCard(card);
  expect(await graph(card).evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  await expectNoOuterOverflow(card);
});

test("a dense saved chart stays inside the existing report preview", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(origin + "/?dense");
  const card = page.locator(cardSelector);
  await favorites(card);
  await saveFavorite(card, "Dense layout example");
  await page.goto(origin + "/?report&dense");
  const paper = page.locator(".report-paper");
  await expect(paper).toBeVisible();
  const before = await paper.boundingBox();
  await page.getByRole("button", { name: "Saved Charts", exact: true }).click();
  await page.getByRole("checkbox", { name: "Dense layout example" }).check();
  const saved = paper.locator("[data-report-chart]");
  await expect(graph(saved).locator("svg.recharts-surface")).toBeVisible();
  const panel = await saved.locator(".chart-panel").boundingBox();
  expect((await paper.boundingBox()).width).toBeCloseTo(before.width, 0);
  expect(panel.x).toBeGreaterThan(before.x);
  expect(panel.x + panel.width).toBeLessThan(before.x + before.width);
  expect(await graph(saved).evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await expectNoOuterOverflow(saved);
});

test("dense cards share a wide row, wrap on mobile and scroll inside their own graphs", async ({ page }) => {
  await page.setViewportSize({ width: 2880, height: 1200 });
  await page.goto(origin + "/?dense");
  const cards = page.locator(cardSelector);
  await cards.first().getByRole("button", { name: "Add chart" }).click();
  await expect(cards).toHaveCount(2);
  const first = cards.first(), second = cards.last();
  const a = await first.boundingBox(), b = await second.boundingBox();
  expect(a.y).toBeCloseTo(b.y, 0);
  expect(b.x).toBeGreaterThan(a.x + a.width);
  expect(b.width).toBeCloseTo(a.width, 0);
  for (const card of [first, second]) await expectPanelFitsCard(card);

  await page.setViewportSize({ width: 390, height: 844 });
  const top = await first.boundingBox(), bottom = await second.boundingBox();
  expect(bottom.x).toBeCloseTo(top.x, 0);
  expect(bottom.y).toBeGreaterThanOrEqual(top.y + top.height);
  for (const card of [first, second]) {
    await expectPanelFitsCard(card);
    await expectNoOuterOverflow(card);
  }
  await graph(second).evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await graph(second).evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  expect(await graph(first).evaluate(el => el.scrollLeft)).toBe(0);

  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: 844 });
    await second.getByRole("button", { name: "Full screen", exact: true }).click();
    const full = await second.locator(".chart-panel-fullscreen").boundingBox();
    expect(full.x).toBe(16);
    expect(full.x + full.width).toBe(width - 16);
    expect(await graph(second).evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await expectNoOuterOverflow(second);
    await page.keyboard.press("Escape");
    await expect(second.locator(".chart-panel-fullscreen")).toHaveCount(0);
    await expectPanelFitsCard(second);
  }
});
