/**
 * Walks a running stack through the path every install takes: the first
 * account, the closed door behind it, a project, an upload analysed by the
 * job runner, the file served back, and the health route.
 *
 *   E2E_BASE_URL=https://localhost:18443 E2E_CA_FILE=apps/e2e/.stack/ca.crt \
 *     bun apps/e2e/src/smoke.ts
 *
 * Uses Bun's built-ins only, so a runner with nothing but Bun can run it
 * against pulled images.
 */
import { toneWav } from "./wav";

const baseUrl = (process.env.E2E_BASE_URL ?? "https://localhost").replace(
  /\/$/,
  ""
);
const caFile = process.env.E2E_CA_FILE;
const origin = new URL(baseUrl).origin;

const JOB_TIMEOUT_MS = 120_000;
const JOB_POLL_MS = 1000;

const password = crypto.randomUUID();
const stamp = Date.now();

const ca = caFile ? await Bun.file(caFile).text() : undefined;

/** A signed-in caller's cookies, as the browser would resend them. */
class Session {
  private cookies = new Map<string, string>();

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Origin", origin);
    if (this.cookies.size > 0) {
      headers.set(
        "Cookie",
        [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
      );
    }
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      ...(ca ? { tls: { ca } } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";");
      const at = pair.indexOf("=");
      if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  }

  json(path: string, method: string, body: unknown): Promise<Response> {
    return this.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}

class StepFailure extends Error {}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StepFailure(message);
}

async function expectStatus(
  response: Response,
  status: number
): Promise<Response> {
  if (response.status !== status) {
    const body = await response.text();
    throw new StepFailure(
      `${response.url} answered ${response.status}, expected ${status}: ${body.slice(0, 300)}`
    );
  }
  return response;
}

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    const result = await run();
    console.log(`ok   ${name}`);
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${name}: ${detail}`);
    process.exit(1);
  }
}

const owner = new Session();

await step("first sign-up makes the instance admin", async () => {
  await expectStatus(
    await owner.json("/api/auth/sign-up/email", "POST", {
      name: "Smoke Owner",
      email: `owner-${stamp}@example.com`,
      password,
    }),
    200
  );
  const me = (await (
    await expectStatus(await owner.request("/api/me"), 200)
  ).json()) as { instanceRole: string | null };
  expect(
    me.instanceRole === "admin",
    `first account's instanceRole is ${me.instanceRole}, expected admin`
  );
});

await step("second sign-up is refused", async () => {
  const response = await new Session().json("/api/auth/sign-up/email", "POST", {
    name: "Smoke Second",
    email: `second-${stamp}@example.com`,
    password,
  });
  // The registration gate's own refusal, not a rate limit or the CSRF check,
  // which would also answer 4xx.
  await expectStatus(response, 403);
  const { message } = (await response.json()) as { message?: string };
  expect(
    message?.includes("Registration is closed") === true,
    `second sign-up was refused with "${message}", not by the registration gate`
  );
});

const projectId = await step("create a project", async () => {
  const response = await expectStatus(
    await owner.json("/api/projects", "POST", {
      name: "Smoke project",
      links: [],
    }),
    201
  );
  return ((await response.json()) as { id: number }).id;
});

const trackId = await step("create a track", async () => {
  const response = await expectStatus(
    await owner.json("/api/tracks", "POST", {
      title: "Smoke track",
      projectId,
    }),
    201
  );
  return ((await response.json()) as { id: number }).id;
});

const wav = toneWav();

const asset = await step("upload a WAV", async () => {
  const form = new FormData();
  form.set("file", new File([wav], "smoke.wav", { type: "audio/wav" }));
  form.set("projectId", String(projectId));
  const response = await expectStatus(
    await owner.request("/api/assets/upload", { method: "POST", body: form }),
    201
  );
  return (await response.json()) as { id: number; assetPath: string };
});

const jobId = await step("link the upload to the track", async () => {
  const response = await expectStatus(
    await owner.json(`/api/tracks/${trackId}/audios`, "POST", {
      assetIds: [asset.id],
    }),
    201
  );
  const { analysisJobIds } = (await response.json()) as {
    analysisJobIds: number[];
  };
  const [queued] = analysisJobIds;
  expect(queued !== undefined, "linking queued no audio_analysis job");
  return queued;
});

await step("the audio_analysis job finishes", async () => {
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let status = "not listed";
  while (Date.now() < deadline) {
    const response = await expectStatus(
      await owner.request(`/api/projects/${projectId}/jobs`),
      200
    );
    const jobs = (await response.json()) as {
      id: number;
      status: string;
      error: string | null;
    }[];
    const job = jobs.find((candidate) => candidate.id === jobId);
    if (job) {
      status = job.status;
      expect(job.status !== "failed", `job ${jobId} failed: ${job.error}`);
      if (job.status === "done") return;
    }
    await Bun.sleep(JOB_POLL_MS);
  }
  throw new StepFailure(
    `job ${jobId} was ${status} after ${JOB_TIMEOUT_MS / 1000}s`
  );
});

await step("the audio is served back under /media", async () => {
  const response = await expectStatus(
    await owner.request(`/media/${asset.assetPath}`),
    200
  );
  const type = response.headers.get("content-type") ?? "";
  expect(type.startsWith("audio/"), `content-type is "${type}"`);
  const body = new Uint8Array(await response.arrayBuffer());
  expect(
    body.length === wav.length,
    `served ${body.length} bytes, uploaded ${wav.length}`
  );
  expect(
    new TextDecoder().decode(body.subarray(0, 4)) === "RIFF",
    "served bytes do not start with RIFF"
  );
});

await step("health reports a version", async () => {
  const response = await expectStatus(
    await new Session().request("/api/health"),
    200
  );
  const { version } = (await response.json()) as { version: unknown };
  expect(
    typeof version === "string" && version.length > 0,
    `version is ${JSON.stringify(version)}`
  );
  // A release run names the version it pushed, which proves `APP_VERSION`
  // reached the image.
  const expected = process.env.E2E_EXPECT_VERSION;
  if (expected) {
    expect(version === expected, `version is ${version}, expected ${expected}`);
  }
});

console.log("smoke passed");
