import { expect, test } from "@playwright/test";

test("VP can use left navigation, configure fields and rounds, and see audit history", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Overview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "VP Overview" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Student Notes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Assessment Builder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Inline Entry Table" })).toHaveCount(0);

  await page.getByRole("button", { name: "Literacy Oral Reading Fluency" }).click();
  await page.getByRole("button", { name: "Assessment Builder" }).click();
  await expect(page.getByText("Custom score column")).toBeVisible();

  await page.getByLabel("Field name").fill("E2E score");
  await page.getByRole("button", { name: "Add field" }).click();
  await expect(page.getByText("E2E score").first()).toBeVisible();

  await page.getByRole("button", { name: "Add round" }).click();
  const roundTitleInputs = page.getByLabel("Round title");
  await roundTitleInputs.last().fill("June Follow-up");
  await expect(roundTitleInputs.last()).toHaveValue("June Follow-up");

  await page.getByRole("button", { name: "Audit Log" }).click();
  await expect(page.getByText("Added field").first()).toBeVisible();
  await expect(page.getByText("Added round").first()).toBeVisible();
});

test("entry table is generated from assessment builder fields and keeps calculated fields locked", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Literacy Oral Reading Fluency" }).click();
  await page.getByRole("button", { name: "Inline Entry Table" }).click();

  await expect(page.getByText("Columns come from the Assessment Builder")).toBeVisible();

  const editableWpmCell = page.locator('.ag-cell[col-id="fall_wpm"]').first();
  const lockedCwpmCell = page.locator('.ag-cell[col-id="fall_cwpm"]').first();

  await expect(editableWpmCell).toHaveText("38");
  await expect(lockedCwpmCell).toHaveText("24");
  await expect(lockedCwpmCell).toHaveClass(/locked-formula-cell/);

  await editableWpmCell.dblclick();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("70");
  await page.keyboard.press("Enter");

  await expect(editableWpmCell).toHaveText("70");
  await expect(lockedCwpmCell).toHaveText("56");
});

test("overview, dashboard filters, notes popup, reports, and files render core workflows", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await expect(page.getByText("All-assessment overview table")).toBeVisible();
  await expect(page.getByLabel("Year")).toBeVisible();
  await expect(page.getByLabel("Grade")).toBeVisible();
  await expect(page.getByText("Oral Reading Fluency").first()).toBeVisible();
  await expect(page.getByText("Quick Write").first()).toBeVisible();
  await expect(page.getByText("AB Ed Numeracy").first()).toBeVisible();

  await page.getByRole("button", { name: "Add new year" }).click();
  await expect(page.getByText("No students are assigned to a homeroom")).toBeVisible();

  await page.getByRole("button", { name: "Add homeroom / students" }).click();
  await expect(page.getByRole("dialog", { name: "Add homeroom and students" })).toBeVisible();
  await page.getByLabel("Home room", { exact: true }).fill("3Z");
  await page.getByLabel("Number of students", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("3Z").first()).toBeVisible();
  await expect(page.locator(".notes-icon").first()).toHaveText("✎");

  await page.getByRole("button", { name: /Move New Student 1/ }).click();
  await expect(page.getByRole("dialog", { name: "Move student" })).toBeVisible();
  await page.locator(".notes-modal select").selectOption("custom");
  await page.locator(".notes-modal input").fill("3Y");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("3Y").first()).toBeVisible();

  await page.getByRole("button", { name: /Remove New Student 1/ }).click();
  await expect(page.getByRole("dialog", { name: "Remove student from homeroom" })).toBeVisible();
  await expect(page.getByText("assessment data will be preserved")).toBeVisible();
  await page.getByRole("button", { name: "Remove from home room" }).click();
  await expect(page.getByText("New Student 1")).toHaveCount(0);

  await page.locator(".notes-icon").first().click();
  await expect(page.locator(".notes-modal")).toBeVisible();
  await expect(page.getByText("Permissions")).toBeVisible();
  await page.locator(".notes-modal textarea").fill("E2E popup note");
  await page.locator(".notes-modal select").selectOption("admin_only");
  await page.locator(".notes-modal").getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("E2E popup note")).toBeVisible();

  await page.locator(".note-card", { hasText: "E2E popup note" }).getByRole("button", { name: "Edit" }).click();
  await page.locator(".notes-modal textarea").fill("E2E popup note edited");
  await page.locator(".notes-modal select").selectOption("all");
  await page.locator(".notes-modal").getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("E2E popup note edited")).toBeVisible();

  await page.locator(".note-card", { hasText: "E2E popup note edited" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("E2E popup note edited")).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Dashboard" }).click();
  await expect(page.getByText("Use filters to focus the charts")).toBeVisible();
  const dashboardFilters = page.locator(".dashboard-filters select");
  await dashboardFilters.nth(0).selectOption("student-b");
  await dashboardFilters.nth(1).selectOption("quick-write");
  await dashboardFilters.nth(2).selectOption("2025-2026");
  await expect(page.getByText("Average score by round")).toBeVisible();
  await expect(page.getByText("Below-50 count by homeroom")).toBeVisible();

  await page.getByRole("button", { name: "Student Report" }).click();
  await expect(page.getByText("Individual assessment summary")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download text report" }).click();
  expect((await download).suggestedFilename()).toContain("assessment-report");

  await page.getByRole("button", { name: "Report Files" }).click();
  await expect(page.getByText("Attach PDFs and downloaded reports")).toBeVisible();
  await expect(page.getByText("Storage Queue")).toBeVisible();
});
