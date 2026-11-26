import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { resolve } from "node:path";
import { toneWav } from "../src/wav";

export { expect, test } from "@playwright/test";

/**
 * The account the `setup` project signs up: the first on a fresh stack, so the
 * instance admin. A run that finds an instance with accounts already fails
 * there rather than here.
 */
export const OWNER = {
  name: "Owner",
  email: "owner@example.com",
  password: "correct horse battery staple",
} as const;

/** Where `setup` saves the owner's session; every other project loads it. */
export const OWNER_STATE = resolve(import.meta.dirname, "../.stack/owner.json");

/**
 * A browser context with no session, for a second visitor: a signed-out guest
 * or a user about to register. A context made from `browser` inherits the
 * project's options, the owner's saved session included, so it is given an
 * empty storage state (`storageState: undefined` would keep the owner's).
 * The caller closes it.
 */
export async function newVisitorContext(
  browser: Browser
): Promise<BrowserContext> {
  return browser.newContext({ storageState: { cookies: [], origins: [] } });
}

/**
 * A project with one track, made through the API as the signed-in owner, for a
 * spec whose subject is something other than creating them.
 */
export async function seedTrack(
  request: APIRequestContext,
  names: { project: string; track: string }
): Promise<{ projectId: number; trackId: number }> {
  const project = await request.post("/api/projects", {
    data: { name: names.project, links: [] },
  });
  expect(project.status()).toBe(201);
  const { id: projectId } = (await project.json()) as { id: number };

  const track = await request.post("/api/tracks", {
    data: { title: names.track, projectId },
  });
  expect(track.status()).toBe(201);
  const { id: trackId } = (await track.json()) as { id: number };
  return { projectId, trackId };
}

/**
 * Uploads a tone through the API and links it to the track as its first audio
 * version, for a spec whose subject is what happens after the audio exists.
 * The upload is a cookie-bearing form post, which the API only takes from a
 * trusted `Origin`; a browser sends one, a request context does not.
 */
export async function seedTrackAudio(
  request: APIRequestContext,
  audio: { projectId: number; trackId: number; seconds?: number }
): Promise<void> {
  const origin = new URL(test.info().project.use.baseURL ?? "").origin;
  const upload = await request.post("/api/assets/upload", {
    headers: { Origin: origin },
    multipart: {
      file: {
        name: "tone.wav",
        mimeType: "audio/wav",
        buffer: Buffer.from(toneWav(audio.seconds)),
      },
      projectId: String(audio.projectId),
    },
  });
  expect(upload.status()).toBe(201);
  const { id: assetId } = (await upload.json()) as { id: number };

  const linked = await request.post(`/api/tracks/${audio.trackId}/audios`, {
    data: { assetIds: [assetId] },
  });
  expect(linked.status()).toBe(201);
}

const BLOCKING_IMPACTS = ["serious", "critical"];

/**
 * Runs axe over the page as it stands and fails on every serious or critical
 * violation, one line each: the rule, its impact and the elements it hit. Every
 * spec calls it on its final page.
 */
export async function expectNoSeriousViolations(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const blocking = violations
    .filter((violation) => BLOCKING_IMPACTS.includes(violation.impact ?? ""))
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.nodes
          .map((node) => node.target.join(" "))
          .join(", ")}`
    );
  expect(blocking, "serious or critical accessibility violations").toEqual([]);
}
