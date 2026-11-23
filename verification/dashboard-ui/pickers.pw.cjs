const { test, expect, origin } = require("./browser.cjs");
const { byButton, cards, studentTrigger, studentMenu } = require("./actions.cjs");

// Each row has two real options; a search input that leaves the list unchanged must fail.
const cases = [
  ["Chart type", "radio", "pArI", "Comparison", "Progression"],
  ["Team", "radio", "eNiO", "Senior team", "Junior team"],
  ["Students", "checkbox", "eN ex", "Ben Example", "Ada Example"],
  ["Assessment", "radio", "BaSe", "Synthetic baseline", "Synthetic diagnostic"],
  ["Window", "radio", "PriN", "Spring", "Fall"],
  ["Home rooms", "checkbox", "10a", "10A", "3A"],
  ["Fields", "checkbox", "UeNc", "Fluency score", "Diagnostic score"],
  ["Sections", "checkbox", "aNsF", "Transfer", "Recall"],
  ["Years", "checkbox", "2024", "2024-2025", "2026-2027"]
];

for (const [label, role, query, target, other] of cases) {
  test(label + ": search narrows options without changing the selection", async ({ page }) => {
    await page.goto(origin + "/?pickers");
    const card = cards(page).first();
    const trigger = card.getByRole("button", { name: role === "radio" ? label : new RegExp("^" + label + ":"), exact: true });
    const menu = card.getByRole("dialog", { name: label, exact: true });
    const search = menu.getByRole("searchbox", { name: "Search " + label, exact: true });
    const option = name => menu.getByRole(role, { name, exact: true });
    await trigger.click();
    await expect(search).toBeFocused();
    await expect(option(other)).toBeVisible();
    const originallyChecked = await option(other).isChecked();
    await search.fill("no-such-option");
    await expect(option(target)).toBeHidden();
    await expect(option(other)).toBeHidden();
    await expect(menu.getByRole("status")).toHaveText("No results");
    await byButton(menu, "Clear " + label + " search").click();
    await expect(search).toBeFocused();
    await expect(option(other)).toBeChecked({ checked: originallyChecked });
    await search.fill(query);
    await expect(option(target)).toBeVisible();
    await expect(option(other)).toBeHidden();
    if (role === "radio") {
      await search.press("ArrowDown");
      await expect(option(target)).toBeFocused();
      await option(target).press("Enter");
    } else {
      await option(target).check();
    }
    if (role === "radio") {
      await expect(trigger).toContainText(target);
    } else {
      await search.fill("");
      await expect(option(other)).toBeChecked({ checked: originallyChecked });
      await byButton(menu, "Close " + label).click();
    }
    await trigger.click();
    await expect(search).toHaveValue("");
    await expect(option(target)).toBeChecked();
    await expect(option(other)).toBeVisible();
  });
}

test("room options are naturally ordered and a hidden room stays selected during a second search", async ({ page }) => {
  await page.goto(origin + "/?pickers");
  const card = cards(page).first();
  const trigger = card.getByRole("button", { name: /^Home rooms:/ });
  const menu = card.getByRole("dialog", { name: "Home rooms" });
  await trigger.click();
  const options = menu.getByRole("checkbox", { name: /^\d+[A-Z]$/ });
  await expect(options).toHaveCount(6);
  expect(await options.evaluateAll(inputs => inputs.map(input => input.labels[0].textContent.trim())))
    .toEqual(["3A", "3B", "9A", "10A", "10B", "11A"]);
  const search = menu.getByRole("searchbox", { name: "Search Home rooms" });
  await search.fill("3A");
  await menu.getByRole("checkbox", { name: "3A", exact: true }).check();
  await search.fill("10A");
  await menu.getByRole("checkbox", { name: "10A", exact: true }).check();
  await byButton(menu, "Close Home rooms").click();
  await studentTrigger(card).click();
  const students = studentMenu(card);
  await expect(students.getByRole("checkbox")).toHaveCount(3);
  await expect(students.getByRole("checkbox", { name: "Ada Example" })).toBeVisible();
  await expect(students.getByRole("checkbox", { name: "Fran Example" })).toBeVisible();
});
