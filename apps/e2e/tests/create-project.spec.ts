import { expect, expectNoSeriousViolations, test } from "./fixtures";

test("create a project, a collection and a track", async ({ page }) => {
  await page.goto("/project/new");
  await page.getByLabel("Name (required)").fill("Night Bus");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^Night Bus/ })
  ).toBeVisible();

  // The sidebar's "+" beside Collections.
  await page.getByRole("link", { name: "New collection" }).click();
  await page.getByLabel("Title").fill("Debut EP");
  await page.getByRole("button", { name: "Create collection" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^Debut EP/ })
  ).toBeVisible();

  // A new track made from the collection is linked to it.
  await page.getByRole("button", { name: "Add Track" }).click();
  await page
    .getByRole("main")
    .getByRole("button", { name: "New track" })
    .click();
  await page.getByRole("menuitem", { name: "New track" }).click();
  const dialog = page.getByRole("dialog", { name: "Create a new track" });
  await dialog.getByLabel("Title").fill("Opening Night");
  await dialog.getByRole("button", { name: "Create track" }).click();
  await expect(dialog).toBeHidden();

  await page
    .getByRole("main")
    .getByRole("link", { name: "Opening Night" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^Opening Night/ })
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Debut EP" }).last()
  ).toBeVisible();

  await expectNoSeriousViolations(page);
});
