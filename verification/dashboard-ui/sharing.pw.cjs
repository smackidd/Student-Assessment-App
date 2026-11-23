const { test, expect, origin } = require("./browser.cjs");
const { byButton, cards, choice, favorites, saveFavorite, sections, selectStudents, sortedScores, subset } = require("./actions.cjs");

test("private, Admin and All favorites appear only for the intended recipient and are read-only", async ({ page, context }) => {
  const name = "Shared fall recall", hidden = "Owner private chart";
  await page.goto(origin);
  const owner = cards(page).first();
  await favorites(owner);
  const ownerList = owner.getByLabel("Saved favorite"), publish = owner.getByRole("checkbox", { name: "Public", exact: true });
  await expect(publish).not.toBeChecked();
  await saveFavorite(owner, hidden);
  await ownerList.selectOption({ label: "New favorite" });
  await expect(publish).not.toBeChecked();
  await byButton(owner, "Close favorites").click();
  await selectStudents(owner, "Ada Example", "Cy Example");
  await choice(owner, "Window", "Fall");
  await subset(owner, "Sections", sections, ["Recall"]);
  await favorites(owner);
  await publish.check();
  const audience = owner.getByRole("combobox", { name: "Audience" });
  await expect(audience).toHaveValue("admin");
  await saveFavorite(owner, name);
  const staff = await context.newPage(), admin = await context.newPage(), report = await context.newPage();
  async function dashboard(p, query) {
    await p.goto(origin + "/?account=second" + query);
    const card = cards(p).first();
    await favorites(card);
    return card;
  }
  const staffCard = await dashboard(staff, ""), adminCard = await dashboard(admin, "&admin");
  const saved = card => card.getByLabel("Saved favorite").locator("option");
  await expect(saved(staffCard)).toHaveText(["New favorite"]);
  await expect(saved(adminCard)).toHaveText(["New favorite", name + " (shared)"]);
  await report.goto(origin + "/?report&account=second");
  await byButton(report, "Saved Charts").click();
  const picker = report.getByRole("group", { name: "Saved Charts", exact: true });
  await expect(picker.getByText("No saved Dashboard charts.")).toBeVisible();
  const saveSharing = async () => {
    await expect(byButton(owner, "Update favorite")).toBeDisabled();
    await byButton(owner, "Save sharing").click();
    await expect(owner.getByRole("status")).toHaveText("Sharing updated.");
  };
  await byButton(owner, "Close favorites").click();
  await choice(owner, "Window", "Spring");
  await subset(owner, "Sections", sections, ["Recall"]);
  await expect.poll(() => sortedScores(owner)).toEqual([3, 13, 83, 93]);
  await favorites(owner);
  await audience.selectOption({ label: "All" });
  await saveSharing();
  await expect(saved(staffCard)).toHaveText(["New favorite", name + " (shared)"]);
  await staffCard.getByLabel("Saved favorite").selectOption({ label: name + " (shared)" });
  await byButton(staffCard, "Apply").click();
  await expect.poll(() => sortedScores(staffCard)).toEqual([0, 10, 80, 90]);
  for (const label of ["Update favorite", "Delete", "Confirm delete"]) {
    await expect(staffCard.getByRole("button", { name: label, exact: true, disabled: false })).toHaveCount(0);
  }
  await expect(staffCard.getByRole("checkbox", { name: "Public", disabled: false })).toHaveCount(0);
  const shared = picker.getByRole("checkbox", { name: new RegExp("^" + name) });
  const plot = report.locator(".report-preview [data-report-chart]");
  await expect(picker).not.toContainText(hidden);
  await shared.check();
  await expect.poll(() => sortedScores(plot)).toEqual([0, 10]); // Only Ada is selected on this report.
  await publish.uncheck();
  await saveSharing();
  await expect(shared).toHaveCount(0);
  await expect(plot).toHaveCount(0);
  await expect(saved(staffCard)).toHaveText(["New favorite"]);
  await expect(saved(adminCard)).toHaveText(["New favorite"]);
  await publish.check();
  await audience.selectOption({ label: "All" });
  await saveSharing();
  await expect(shared).not.toBeChecked();
  await shared.check();
  await expect(plot).toHaveCount(1);
  await byButton(owner, "Delete").click();
  await byButton(owner, "Confirm delete").click();
  await expect(owner.getByRole("status")).toHaveText("Favorite deleted.");
  await expect(shared).toHaveCount(0);
  await expect(plot).toHaveCount(0);
  await expect(saved(staffCard)).toHaveText(["New favorite"]);
  await expect(saved(owner)).toHaveText(["New favorite", hidden]);
});
