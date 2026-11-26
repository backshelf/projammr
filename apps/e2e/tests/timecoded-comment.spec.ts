import {
  expect,
  expectNoSeriousViolations,
  seedTrack,
  seedTrackAudio,
  test,
} from "./fixtures";

test("a comment left at the playhead shows its timecode and jumps back to it", async ({
  page,
  request,
}) => {
  const { projectId, trackId } = await seedTrack(request, {
    project: "Mix notes project",
    track: "Mix notes track",
  });
  await seedTrackAudio(request, { projectId, trackId, seconds: 60 });
  await page.goto(`/project/${projectId}/track/${trackId}`);
  await expect(
    page.getByRole("button", { name: "Choose a version" })
  ).toContainText("tone.wav");

  // Playing loads the audio into the player, which gives a comment a playhead
  // to pin to; pausing straight away leaves the playhead where the keys put it.
  await page
    .getByRole("button", { name: "Play Mix notes track", exact: true })
    .click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();

  // The seek slider steps five seconds per arrow key; Home returns to the start.
  const seek = page
    .getByRole("main")
    .getByRole("slider", { name: "Seek", exact: true });
  await seek.focus();
  await seek.press("ArrowRight");
  await seek.press("ArrowRight");
  await expect(seek).toHaveAttribute("aria-valuetext", "0:10 of 1:00");

  await page.getByRole("button", { name: "Comments on v1" }).click();
  // The popover is named as its pill is, so its name gains the count once a
  // comment is posted.
  const comments = page.getByRole("dialog", { name: /on v1$/ });
  await comments
    .getByPlaceholder("Write a comment…")
    .fill("Kick is buried here");
  await expect(comments.getByRole("button", { name: "At 0:10" })).toBeVisible();
  await comments.getByRole("button", { name: "Comment", exact: true }).click();

  // The posted comment carries the time it was left at.
  const stamp = comments.getByRole("button", { name: "0:10" });
  await expect(stamp).toBeVisible();
  await expect(comments.getByText("Kick is buried here")).toBeVisible();
  const pill = page.getByRole("button", { name: "1 comment on v1" });
  await expect(pill).toBeVisible();

  // Following the timecode moves the playhead back to it. Closing the popover
  // hands focus back to its pill; the slider takes it only after that.
  await page.keyboard.press("Escape");
  await expect(comments).toBeHidden();
  await expect(pill).toBeFocused();
  await seek.focus();
  await seek.press("Home");
  await expect(seek).toHaveAttribute("aria-valuetext", "0:00 of 1:00");
  await pill.click();
  await stamp.click();
  await expect(seek).toHaveAttribute("aria-valuetext", "0:10 of 1:00");

  await expectNoSeriousViolations(page);
});
