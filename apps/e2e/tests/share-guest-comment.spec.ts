import {
  expect,
  expectNoSeriousViolations,
  newVisitorContext,
  seedTrack,
  seedTrackAudio,
  test,
} from "./fixtures";

// The share link's only copy control writes to the clipboard, so the owner's
// page needs both directions of it to hand the link to the guest.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("a guest opens a share link signed out, comments, and the owner sees it", async ({
  page,
  browser,
  request,
}) => {
  const { projectId, trackId } = await seedTrack(request, {
    project: "Shared project",
    track: "Shared track",
  });
  await seedTrackAudio(request, { projectId, trackId });

  // The owner makes a link from the track's sharing rail and copies it.
  await page.goto(`/project/${projectId}/track/${trackId}`);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share" });
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "Copy share link" }).click();
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(shareUrl).pathname).toMatch(/^\/share\/.+/);

  // A signed-out visitor reads the share and signs in as a guest to comment.
  const visitor = await newVisitorContext(browser);
  const guest = await visitor.newPage();
  await guest.goto(shareUrl);
  await expect(
    guest.getByRole("heading", { name: "Shared track" })
  ).toBeVisible();
  await expect(
    guest.getByRole("main").getByText("Sign in as a guest to leave a comment.")
  ).toBeVisible();

  await guest.getByLabel("Your name").fill("Guest Listener");
  await guest.getByRole("button", { name: "Continue as guest" }).click();
  const composer = guest.getByPlaceholder("Write a comment…");
  await composer.fill("Love the low end");
  await guest.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(guest.getByText("Love the low end")).toBeVisible();
  await expect(guest.getByText("Guest Listener")).toBeVisible();

  // The guest's page is one a reader can land on, so axe reads it as well as
  // the owner's final page.
  await expectNoSeriousViolations(guest);
  await visitor.close();

  // The owner's own page carries the guest's comment on the audio.
  await page.goto(`/project/${projectId}/track/${trackId}`);
  await page.getByRole("button", { name: "1 comment on v1" }).click();
  const comments = page.getByRole("dialog", { name: /on v1$/ });
  await expect(comments.getByText("Love the low end")).toBeVisible();
  await expect(comments.getByText("Guest Listener")).toBeVisible();

  // The popover fades in; axe reads colours mid-fade as low contrast.
  await expect(comments).toHaveCSS("opacity", "1");
  await expectNoSeriousViolations(page);
});
