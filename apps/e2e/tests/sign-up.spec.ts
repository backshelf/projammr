import {
  expect,
  expectNoSeriousViolations,
  OWNER,
  OWNER_STATE,
  test as setup,
} from "./fixtures";

setup("the first sign-up creates the instance admin", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Create the first account" })
  ).toBeVisible();

  await page.getByLabel("Name").fill(OWNER.name);
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Signed in: the sign-up card is replaced by the app, which answers as the
  // owner.
  await expect(
    page.getByRole("heading", { name: "Create the first account" })
  ).toBeHidden();
  const me = await page.request.get("/api/me");
  expect(me.ok()).toBe(true);
  expect(await me.json()).toMatchObject({
    email: OWNER.email,
    instanceRole: "admin",
  });

  await expectNoSeriousViolations(page);
  await page.context().storageState({ path: OWNER_STATE });
});
