import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect } from "bun:test";
import type { Spectrum } from "@workspace/dsp/spectrum";
import { app } from "../app.js";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { db } from "../db/index.js";
import { deleteAccount } from "../db/queries/account-deletion.js";
import { setRegistration } from "../db/queries/settings.js";
import { assets } from "../db/schema/assets.js";
import { users } from "../db/schema/auth.js";
import { trackAudios } from "../db/schema/tracks.js";
import { trustedOrigins } from "../lib/env.js";
import { isAudioName } from "../lib/media.js";

export const baseUrl = "/api";
export const authUrl = "/auth";
export const password = "password123";

/**
 * The origin a real browser sends on every same-origin POST, not only a
 * cross-site one — `csrfProtection` (`middleware/trusted-origin.ts`) refuses a
 * form post that carries neither `Origin` nor `Sec-Fetch-Site`, so every
 * fixture that uploads through a cookie has to name one.
 */
export const trustedOrigin = trustedOrigins[0]!;

/**
 * A distinct simulated caller for `clientAddress`'s socket fallback (the
 * default outside compose, `TRUSTED_PROXY_HOPS = 0`) — without it, every
 * unauthenticated sign-up or sign-in in one test file shares the same
 * `"unknown"` bucket and starves out `auth-signin`/`auth-signup`'s burst, the
 * way distinct real devices never would.
 */
export const distinctCallerEnv = () => ({
  requestIP: () => ({
    address: crypto.randomUUID(),
    family: "IPv4" as const,
  }),
});

export type Actor = {
  name: string;
  cookie: string;
  token: string;
  userId: string;
  email: string;
};

/**
 * A request as each kind of caller. Every endpoint is checked through these so
 * that a route added without an `authorizeProject` mount fails the suite.
 */
export type Caller = "anonymous" | "outsider" | "viewer" | "editor" | "owner";

export type ProjectRole = "admin" | "editor" | "viewer";

export function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  for (const part of setCookie.split(/,(?=[^;]*=)/)) {
    const [k, ...v] = part.trim().split(";")[0]!.split("=");
    if (k === "better-auth.session_token") return `${k}=${v.join("=")}`;
  }
  throw new Error("session cookie not found in set-cookie header");
}

/**
 * Signs an account up and in. On a database no account has claimed, the run's
 * first sign-up becomes the instance admin, whichever file made it. `plain`
 * demotes the account in its row between the two, so the session it signs in
 * to already carries the ordinary role and a test that wants an admin has to
 * promote one itself.
 */
export async function signUpAndSignIn(
  name: string,
  { plain = false }: { plain?: boolean } = {}
): Promise<Actor> {
  // The instance these tests run against was claimed by its first account long
  // ago, so its registration is closed — the state a real instance settles in.
  // A suite is the operator of its own instance: it reopens registration rather
  // than minting an invite for each of the actors it needs. The tests that
  // exercise a closed instance run in the serial phase, where no other file is
  // signing up beside them.
  await setRegistration("open", null);

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const email = `${slug}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.com`;
  const headers = { "Content-Type": "application/json" };
  const env = distinctCallerEnv();

  // On a database no account has claimed, the parallel run's first sign-up
  // bootstraps the instance and closes registration, which can land between
  // this file's reopen and its sign-up. A 403 reopens and tries again.
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    const signUpRes = await app.request(
      `${baseUrl}${authUrl}/sign-up/email`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email, password, name }),
      },
      env
    );
    if (signUpRes.status === 200) break;
    if (signUpRes.status !== 403 || attempt === maxAttempts) {
      throw new Error(`sign-up failed for ${name}: ${signUpRes.status}`);
    }
    await setRegistration("open", null);
  }

  if (plain) {
    await db
      .update(users)
      .set({ instanceRole: "user" })
      .where(eq(users.email, email));
  }

  const signInRes = await app.request(
    `${baseUrl}${authUrl}/sign-in/email`,
    { method: "POST", headers, body: JSON.stringify({ email, password }) },
    env
  );
  if (signInRes.status !== 200) {
    throw new Error(`sign-in failed for ${name}: ${signInRes.status}`);
  }

  const body = await signInRes.json();
  return {
    name,
    cookie: extractSessionCookie(signInRes),
    token: body.token as string,
    userId: body.user.id as string,
    email,
  };
}

export function cookieHeaders(cookie: string) {
  return { "Content-Type": "application/json", Cookie: cookie };
}

/**
 * Another sign-in of an actor's account, as a second client of it holds: its
 * own session, so ending it leaves the actor's own cookie signed in.
 */
export async function signInAgain(actor: Actor): Promise<Actor> {
  const res = await app.request(
    `${baseUrl}${authUrl}/sign-in/email`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: actor.email, password }),
    },
    distinctCallerEnv()
  );
  if (res.status !== 200) {
    throw new Error(`sign-in failed for ${actor.name}: ${res.status}`);
  }
  const body = await res.json();
  return {
    ...actor,
    cookie: extractSessionCookie(res),
    token: body.token as string,
  };
}

/** A guest: the anonymous session a share page signs a reader into when they
 *  want to leave a comment and have no account. */
export async function signInAsGuest(): Promise<string> {
  const res = await app.request(`${baseUrl}${authUrl}/sign-in/anonymous`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (res.status !== 200) {
    throw new Error(`anonymous sign-in failed: ${res.status}`);
  }
  return extractSessionCookie(res);
}

/** The public path a stored key is served from — the server's `staticUrl`. */
export const servedAt = (assetPath: string) => `/static/${assetPath}`;

/** Where a stored key lives on disk, relative to the server's working directory. */
export const onDiskPath = (assetPath: string) => `static/${assetPath}`;

export const testImage = () => readFile("./testimage.jpeg");

/**
 * A WAV header and nothing else: enough for the upload's signature check, too
 * little for ffmpeg to read. `makeAudible` swaps it for a real tone.
 */
export const fakeWav = "RIFF\0\0\0\0WAVEfmt ";

export type ImageParentKind = "project" | "collection" | "track";

/**
 * The request that sets an image as a parent's cover, as the API takes it
 * today. `projectId` is accepted for callers that still pass it (the
 * resolver derives the project from the parent) and is not sent.
 */
export function setParentImageRequest(input: {
  imageId: number;
  kind: ImageParentKind;
  parentId: number;
  projectId: number;
}): { method: string; path: string; body: unknown } {
  return {
    method: "PUT",
    path: `/images/parent/${input.kind}/${input.parentId}`,
    body: { imageId: input.imageId },
  };
}

/** Issues `setParentImageRequest` through `send` and returns the response. */
export function setParentImage(
  send: (path: string, init?: RequestInit) => Promise<Response>,
  input: {
    imageId: number;
    kind: ImageParentKind;
    parentId: number;
    projectId: number;
  }
): Promise<Response> {
  const { method, path, body } = setParentImageRequest(input);
  return send(path, { method, body: JSON.stringify(body) });
}

export type Suite = ReturnType<typeof setupSuite>;

/**
 * Deletes the accounts a suite signed up, one after another, the way a real
 * account deletion does: `deleteAccount` (the `beforeDelete` hook Better Auth
 * runs, `auth.ts`) and then the `users` row. An account already gone is
 * skipped, and one `deleteAccount` refuses (the instance's last admin, a
 * project a test left with other members) stays, so a green file never fails
 * on its teardown. Any other error propagates, after every account has had its
 * turn.
 */
export async function deleteSuiteUsers(userIds: readonly string[]) {
  let failure: unknown = null;
  for (const userId of userIds) {
    try {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId));
      if (!row) continue;
      await deleteAccount(userId);
      await db.delete(users).where(eq(users.id, userId));
    } catch (error) {
      if (error instanceof APIError && error.statusCode === 409) continue;
      failure ??= error;
    }
  }
  if (failure) throw failure;
}

/**
 * The world every route test needs: a project, an owner, an editor, a viewer and
 * a signed-in non-member, plus the request helpers and factories that work
 * against them. Call it once at the top of a test file — it registers its own
 * `beforeAll`/`afterAll`, so the project is built before the first test and
 * deleted after the last.
 *
 * Each file gets a project of its own, which is what lets the files run in
 * parallel: no test can see another file's rows through the API, because every
 * list endpoint is scoped to a project. `label` names the project and its actors
 * so a row left behind by a crashed run says which file made it.
 */
export function setupSuite(label: string) {
  /**
   * The actors are handed back before `beforeAll` fills them, so they have to be
   * the same objects throughout — a test file destructures them at module scope
   * and reads `owner.cookie` much later, inside a test body.
   */
  const owner = {} as Actor;
  const editor = {} as Actor;
  const viewer = {} as Actor;
  const outsider = {} as Actor;

  let projectId: number;

  /**
   * Set when the shared project could not be created. Every test asserts on this
   * first: without the project there is nothing meaningful to test, so the run
   * reports one real failure instead of dozens of identical cascading ones.
   */
  let setUpError: unknown = null;

  /** Extra projects a test asked for, deleted alongside the suite's own. */
  const throwaways: { id: number; owner: Actor }[] = [];

  /** Every account the suite signed up, deleted after its projects. */
  const suiteUserIds: string[] = [];

  /** Signs an account up and records it for the suite's teardown. */
  async function signUpSuiteActor(name: string, options?: { plain?: boolean }) {
    const actor = await signUpAndSignIn(name, options);
    suiteUserIds.push(actor.userId);
    return actor;
  }

  const requireProject = () => {
    if (setUpError) {
      throw new Error(
        `shared project setup failed, test cannot run: ${String(setUpError)}`
      );
    }
  };

  async function createProject(as: Actor, name: string): Promise<number> {
    const res = await app.request(`${baseUrl}/projects`, {
      method: "POST",
      headers: cookieHeaders(as.cookie),
      body: JSON.stringify({
        name,
        description: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "The one project every test in this file shares",
              },
            ],
          },
        ],
        links: [],
      }),
    });
    if (res.status !== 201) {
      throw new Error(
        `project creation returned ${res.status}: ${await res.text()}`
      );
    }
    return (await res.json()).id as number;
  }

  /**
   * Adds a signed-in actor to a project at a given role, the way a real user
   * joins: an owner sends an invite, the actor accepts it. Used for the suite's
   * fixed editor/viewer and to restore a membership a test removed.
   */
  async function seedMemberOf(
    project: number,
    projectOwner: Actor,
    actor: Actor,
    role: ProjectRole
  ) {
    const invited = await app.request(
      `${baseUrl}/projects/${project}/invites`,
      {
        method: "POST",
        headers: cookieHeaders(projectOwner.cookie),
        body: JSON.stringify({ email: actor.email, role }),
      }
    );
    if (invited.status !== 201) {
      throw new Error(
        `invite for ${actor.email} returned ${invited.status}: ${await invited.text()}`
      );
    }
    const { token } = await invited.json();

    const accepted = await app.request(`${baseUrl}/invites/${token}/accept`, {
      method: "POST",
      headers: cookieHeaders(actor.cookie),
    });
    if (accepted.status !== 200) {
      throw new Error(
        `accept for ${actor.email} returned ${accepted.status}: ${await accepted.text()}`
      );
    }
  }

  const seedMember = (actor: Actor, role: ProjectRole) =>
    seedMemberOf(projectId, owner, actor, role);

  /**
   * A second project with an editor of its own, torn down with the suite. The
   * cross-project rules — that an id from one project is not accepted in
   * another — need somewhere to point at that the suite's actors cannot reach.
   */
  async function throwawayProject(name = "Throwaway") {
    const projectOwner = await signUpSuiteActor(`${label} ${name} Owner`);
    const id = await createProject(
      projectOwner,
      `${label} ${name} ${Date.now()}`
    );
    throwaways.push({ id, owner: projectOwner });

    const projectEditor = await signUpSuiteActor(`${label} ${name} Editor`);
    await seedMemberOf(id, projectOwner, projectEditor, "editor");

    return { id, owner: projectOwner, editor: projectEditor };
  }

  beforeAll(async () => {
    try {
      const plain = { plain: true };
      Object.assign(owner, await signUpSuiteActor(`${label} Owner`, plain));
      projectId = await createProject(owner, `${label} ${Date.now()}`);

      Object.assign(editor, await signUpSuiteActor(`${label} Editor`, plain));
      Object.assign(viewer, await signUpSuiteActor(`${label} Viewer`, plain));
      Object.assign(
        outsider,
        await signUpSuiteActor(`${label} Outsider`, plain)
      );
      await seedMember(editor, "editor");
      await seedMember(viewer, "viewer");
    } catch (error) {
      setUpError = error;
    }
  });

  afterAll(async () => {
    try {
      for (const { id, owner: projectOwner } of throwaways) {
        await app.request(`${baseUrl}/projects/${id}`, {
          method: "DELETE",
          headers: cookieHeaders(projectOwner.cookie),
        });
      }

      if (setUpError || projectId == null) return;

      const res = await app.request(`${baseUrl}/projects/${projectId}`, {
        method: "DELETE",
        headers: cookieHeaders(owner.cookie),
      });
      if (!res.ok) {
        throw new Error(`failed to clean up shared project: ${res.status}`);
      }
    } finally {
      await deleteSuiteUsers(suiteUserIds);
    }
  });

  async function uploadAsset(
    name: string,
    extra: Record<string, string> = {},
    cookie = owner.cookie
  ) {
    // An audio name has to carry audio bytes or the upload is refused.
    const file = isAudioName(name)
      ? new File([fakeWav], name, { type: "audio/wav" })
      : new File([await testImage()], name, { type: "image/jpeg" });
    const form = new FormData();
    form.append("file", file);
    form.append("projectId", String(projectId));
    for (const [key, value] of Object.entries(extra)) form.append(key, value);

    const res = await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as {
      id: number;
      assetPath: string;
      name: string;
      localFilepath: string | null;
      localFileCreatedAt: string | null;
      localFileUpdatedAt: string | null;
      localFileMachineName: string | null;
      fingerprint: string | null;
    };
  }

  /**
   * Uploads an asset with an explicit media type and body. The serving policy is
   * decided from the stored MIME, so the tests that exercise it need to control
   * what gets stored — `uploadAsset` sends the same jpeg, or `fakeWav` for an
   * audio name.
   */
  async function uploadTypedAsset(
    name: string,
    type: string,
    bytes: BlobPart,
    cookie = owner.cookie,
    intoProject = projectId
  ) {
    const form = new FormData();
    form.append("file", new File([bytes], name, { type }));
    form.append("projectId", String(intoProject));

    const res = await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as {
      id: number;
      assetPath: string;
      name: string;
    };
  }

  /** An image uploaded with no project: an avatar, readable by any signed-in user. */
  async function uploadAvatar(name: string, cookie = owner.cookie) {
    const form = new FormData();
    form.append(
      "file",
      new File([await testImage()], name, { type: "image/jpeg" })
    );

    const res = await app.request(`${baseUrl}/images/upload`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as {
      id: number;
      assetPath: string;
      scope: "project" | "user";
      variantsJobId: number | null;
    };
  }

  async function uploadImage(name: string, cookie = owner.cookie) {
    const form = new FormData();
    form.append(
      "file",
      new File([await testImage()], name, {
        type: "image/jpeg",
      })
    );
    form.append("projectId", String(projectId));

    const res = await app.request(`${baseUrl}/images/upload`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: trustedOrigin },
      body: form,
    });
    expect(res.status).toBe(201);
    return (await res.json()) as {
      id: number;
      assetPath: string;
      name: string;
      variantsJobId: number | null;
    };
  }

  async function mkTrack(title: string, cookie = owner.cookie) {
    const res = await app.request(`${baseUrl}/tracks`, {
      method: "POST",
      headers: cookieHeaders(cookie),
      body: JSON.stringify({ title, artists: ["A"], projectId }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).id as number;
  }

  async function mkCollection(title: string, cookie = owner.cookie) {
    const res = await app.request(`${baseUrl}/collections`, {
      method: "POST",
      headers: cookieHeaders(cookie),
      body: JSON.stringify({ title, projectId }),
    });
    expect(res.status).toBe(201);
    return (await res.json()).id as number;
  }

  async function mkSession(
    body: Record<string, unknown> = {},
    cookie = owner.cookie
  ) {
    const res = await app.request(`${baseUrl}/sessions`, {
      method: "POST",
      headers: cookieHeaders(cookie),
      body: JSON.stringify({ name: "S", daw: "ableton", projectId, ...body }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as {
      id: number;
      name: string;
      trackId: number | null;
      main: boolean;
    };
  }

  /**
   * A primary audio with a measured loudness (and, optionally, a detected
   * tempo and key), written straight to the rows: readers of these fields
   * only look at their own `track_audios` column, so no real ffmpeg pass is
   * needed to exercise them.
   */
  async function mkPrimaryAudioWithLoudness(
    trackId: number,
    lufs: number,
    ltas?: Spectrum,
    tempoAndKey?: { bpm?: number; musicalKey?: string }
  ) {
    const [asset] = await db
      .insert(assets)
      .values({
        name: `loud-${trackId}.wav`,
        type: "audio/wav",
        size: 0,
        assetPath: `./static/assets/loudness-test-${trackId}-${Date.now()}.wav`,
        projectId,
      })
      .returning({ id: assets.id });

    await db.insert(trackAudios).values({
      trackId,
      assetId: asset!.id,
      version: 1,
      isPrimary: true,
      lufs,
      ltas,
      bpm: tempoAndKey?.bpm,
      musicalKey: tempoAndKey?.musicalKey,
    });
  }

  /**
   * A status name is unique within its project, and the whole file shares one
   * project, so each status a run creates needs a name distinct from the others.
   */
  let statusCounter = 0;
  const uniqueStatusName = (statusLabel: string) =>
    `${statusLabel} ${statusCounter++}`;

  async function mkStatus(statusLabel: string, percentage = 50) {
    const res = await app.request(`${baseUrl}/statuses`, {
      method: "POST",
      headers: cookieHeaders(owner.cookie),
      body: JSON.stringify({
        name: uniqueStatusName(statusLabel),
        percentage,
        projectId,
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: number; name: string };
  }

  const callerCookie: Record<Exclude<Caller, "anonymous">, () => string> = {
    outsider: () => outsider.cookie,
    viewer: () => viewer.cookie,
    editor: () => editor.cookie,
    owner: () => owner.cookie,
  };

  async function request(
    caller: Caller,
    path: string,
    init: RequestInit = {}
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    };
    if (caller !== "anonymous") headers.Cookie = callerCookie[caller]();
    return app.request(`${baseUrl}${path}`, { ...init, headers });
  }

  /** The same call as `request`, for an actor outside the suite's fixed four. */
  const requestAs = (actor: Actor, path: string, init: RequestInit = {}) =>
    app.request(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Cookie: actor.cookie,
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });

  /**
   * Asserts the access rules for one endpoint: an anonymous caller is always
   * rejected with 401, a signed-in non-member with 404 (no existence leak), and
   * each listed role gets the status it is entitled to. `expected` names only
   * the roles worth stating —
   * a read lists `viewer`, a write lists `viewer` (403) and `editor`.
   *
   * `assertBody` runs against the parsed body of every allowed call, so a route
   * that answers 200 with another tenant's rows fails here rather than passing on
   * its status code alone.
   *
   * `headersFor` adds headers to each listed role's own call, for a route that
   * needs something of the caller's, such as the machine a push is made from.
   */
  async function expectAccess(
    method: string,
    path: string,
    expected: Partial<Record<Exclude<Caller, "anonymous">, number>>,
    body?: unknown,
    assertBody?: (parsed: unknown, caller: Caller) => void,
    headersFor?: (
      caller: Exclude<Caller, "anonymous">
    ) => Promise<Record<string, string>>
  ) {
    const init: RequestInit = { method };
    if (body !== undefined) init.body = JSON.stringify(body);

    const anon = await request("anonymous", path, init);
    expect(anon.status, `${method} ${path} as anonymous`).toBe(401);

    const stranger = await request("outsider", path, init);
    expect(stranger.status, `${method} ${path} as outsider`).toBe(404);

    for (const [name, status] of Object.entries(expected)) {
      const caller = name as Exclude<Caller, "anonymous">;
      const res = await request(caller, path, {
        ...init,
        headers: headersFor ? await headersFor(caller) : undefined,
      });
      expect(res.status, `${method} ${path} as ${caller}`).toBe(status);

      if (assertBody && status >= 200 && status < 300) {
        assertBody(await res.json(), caller);
      }
    }
  }

  return {
    owner,
    editor,
    viewer,
    outsider,
    get projectId() {
      return projectId;
    },
    /**
     * Whether the project could not be built. A `beforeAll` of its own has
     * nothing to hang its fixtures off in that case, so it bails and lets
     * `requireProject` report the one real failure.
     */
    get setUpFailed() {
      return setUpError != null;
    },
    requireProject,
    request,
    requestAs,
    expectAccess,
    seedMember,
    throwawayProject,
    mkTrack,
    mkCollection,
    mkSession,
    mkStatus,
    mkPrimaryAudioWithLoudness,
    uniqueStatusName,
    uploadAsset,
    uploadTypedAsset,
    uploadAvatar,
    uploadImage,
  };
}
