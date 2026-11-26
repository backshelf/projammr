import { toneWav } from "../src/wav";
import { expect, expectNoSeriousViolations, seedTrack, test } from "./fixtures";

test("upload audio to a track and play it", async ({ page, request }) => {
  const { projectId, trackId } = await seedTrack(request, {
    project: "Tone project",
    track: "Tone track",
  });
  await page.goto(`/project/${projectId}/track/${trackId}`);

  await page.getByRole("button", { name: "Add a track audio" }).click();
  const dialog = page.getByRole("dialog", { name: "Track audios" });
  // The drop zone's file input is hidden; the drop zone around it is the
  // control a person uses.
  // Long enough that the player is still playing when the checks below run on
  // a slow runner; a two-second tone can end first.
  await dialog.locator("input[type=file]").setInputFiles({
    name: "tone.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from(toneWav(10)),
  });
  // Uploaded and linked as the track's first version.
  await expect(
    dialog.getByRole("checkbox", { name: /tone\.wav/ })
  ).toBeChecked();
  await dialog.getByRole("button", { name: /^Save 1 version/ }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Choose a version" })
  ).toContainText("tone.wav");

  await page
    .getByRole("button", { name: "Play Tone track", exact: true })
    .click();

  // The player bar's control turns to Pause and the track's waveform seek
  // position moves off zero while the tone plays.
  await expect(
    page.getByRole("button", { name: "Pause", exact: true })
  ).toBeVisible();
  const seek = page
    .getByRole("main")
    .getByRole("slider", { name: "Seek", exact: true });
  await expect
    .poll(async () => Number(await seek.getAttribute("aria-valuenow")))
    .toBeGreaterThan(0);

  await expectNoSeriousViolations(page);
});
