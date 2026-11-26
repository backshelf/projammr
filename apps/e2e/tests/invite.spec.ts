import {
  expect,
  expectNoSeriousViolations,
  newVisitorContext,
  seedTrack,
  test,
} from "./fixtures";

// The invite link is only ever copied, never shown, so the owner's page needs
// both directions of the clipboard to hand it to the invitee.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const INVITEE = {
  name: "Invitee",
  email: "invitee@example.com",
  password: "another long passphrase",
} as const;

test("an invited person registers, accepts, and joins the project", async ({
  page,
  browser,
  request,
}) => {
  const { projectId } = await seedTrack(request, {
    project: "Invite project",
    track: "Invite track",
  });

  // The owner invites the second email and copies the invite link.
  const membersUrl = `/settings/project/${projectId}/members`;
  await page.goto(membersUrl);
  await page.getByLabel("Email address").fill(INVITEE.email);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByText(INVITEE.email, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy link" }).click();
  const inviteUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(inviteUrl).pathname).toMatch(/^\/invite\/.+/);

  // Registration is closed, but an invited address may still sign up. The
  // invitee opens the link signed out, creates the account and accepts.
  const visitor = await newVisitorContext(browser);
  const invitee = await visitor.newPage();
  await invitee.goto(inviteUrl);
  await expect(invitee.getByLabel("Email")).toHaveValue(INVITEE.email);
  await invitee.getByLabel("Name").fill(INVITEE.name);
  await invitee.getByLabel("Password").fill(INVITEE.password);
  await invitee.getByRole("button", { name: "Create account" }).click();
  await invitee.getByRole("button", { name: "Accept invite" }).click();
  await expect(invitee).toHaveURL(new RegExp(`/project/${projectId}$`));
  await expect(
    invitee.getByRole("heading", { name: "Invite project" })
  ).toBeVisible();
  await visitor.close();

  // The owner's members list now has them, with the role the invite carried.
  await page.goto(membersUrl);
  await expect(
    page.getByRole("combobox", { name: `Role for ${INVITEE.name}` })
  ).toHaveText("viewer");
  await expect(
    page.getByRole("main").getByText("No pending invites.")
  ).toBeVisible();

  await expectNoSeriousViolations(page);
});
