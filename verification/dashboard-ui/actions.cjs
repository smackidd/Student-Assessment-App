const { expect } = require("./browser.cjs");

const byButton = (root, name) => root.getByRole("button", { name, exact: true });
const cards = page => page.locator("[data-dashboard-chart]");
const pointValues = card => card.locator("[data-point-value]");
const sortedScores = async card => (await pointValues(card).allTextContents()).map(Number).sort((a,b) => a-b);
const recall = "Diagnostic score / Recall";
const recallWindows = ["Fall", "Spring"].map(window => ["2026-2027", window, "Recall"].join(" \u00b7 "));
async function expectProgression(card, categories, series) {
  const legend = card.getByRole("list", { name: "Chart legend" }).getByRole("listitem");
  await expect(legend).toHaveCount(Object.keys(series).length);
  await expect(card.locator("[data-axis-tick] title")).toHaveText(categories);
  await expect.poll(() => card.evaluate(el => {
    // Match rendered score labels to their legend swatch and horizontal window, not DOM order.
    const xs = [...el.querySelectorAll("[data-axis-tick]")].map(t => t.transform.baseVal.getItem(0).matrix.e);
    const values = [...el.querySelectorAll("[data-point-value]")];
    return Object.fromEntries([...el.querySelectorAll('[aria-label="Chart legend"] li')].map(item => {
      const color = getComputedStyle(item.querySelector("i")).backgroundColor;
      return [item.textContent.trim(), xs.map(x => {
        const score = values.find(v => getComputedStyle(v).fill === color && Math.abs(Number(v.getAttribute("x")) - x) < 1);
        return score ? Number(score.textContent) : null;
      })];
    }));
  })).toEqual(series);
  const marks = Object.values(series).flat().filter(value => value !== null).length;
  await expect(pointValues(card)).toHaveCount(marks);
  await expect(card.locator(".recharts-line-dot")).toHaveCount(marks);
}
const control = byButton;
async function choice(card, label, option) {
  await control(card, label).click();
  await card.getByRole("radio", { name: option, exact: true }).click();
  await expect(control(card, label)).toContainText(option);
}
async function subset(card, label, available, wanted) {
  await card.getByRole("button", { name: new RegExp("^" + label + ":") }).click();
  for (const name of wanted) await card.getByRole("checkbox", { name, exact: true }).check();
  for (const name of available.filter(n => !wanted.includes(n))) {
    await card.getByRole("checkbox", { name, exact: true }).uncheck();
  }
  await byButton(card, "Close " + label).click();
}
const rooms = ["3A", "3B", "7C"];
const sections = ["Recall", "Reasoning", "Transfer"];
const years = ["2024-2025", "2025-2026", "2026-2027"];
const studentTrigger = card => card.getByRole("button", { name: /^Students:/ });
const studentMenu = card => card.getByRole("dialog", { name: "Students", exact: true });
async function selectStudents(card, ...names) {
  await studentTrigger(card).click();
  const menu = studentMenu(card);
  for (const name of names) {
    await menu.getByRole("searchbox", { name: "Search Students" }).fill(name);
    await menu.getByRole("checkbox", { name, exact: true }).check();
  }
  await byButton(menu, "Close Students").click();
}
async function favorites(root) {
  await root.getByText("Favorites", { exact: true }).click();
  await expect(root.getByLabel("Saved favorite")).toBeVisible();
}
async function saveFavorite(root, name) {
  await root.getByLabel("Favorite name").fill(name);
  await byButton(root, "Save favorite").click();
  await expect(root.getByRole("status")).toHaveText("Favorite saved.");
}

module.exports = { byButton, cards, pointValues, sortedScores, recall, recallWindows, expectProgression, control, choice, subset,
  rooms, sections, years, favorites, saveFavorite, studentMenu, studentTrigger, selectStudents };
