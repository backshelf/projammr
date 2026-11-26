import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import pg from "pg";
import { waitFor } from "@workspace/test/wait-for";
import { app } from "../app.js";
import { db } from "../db/index.js";
import { assets } from "../db/schema/assets.js";
import { comments } from "../db/schema/comments.js";
import {
  sharelinkSnapshotTrackAudios,
  sharelinks,
} from "../db/schema/sharelinks.js";
import { trackAudios } from "../db/schema/tracks.js";
import { setBindParamLimitForTest } from "../lib/chunk.js";
import { subscribeProject } from "../lib/job-events.js";
import * as media from "../lib/media.js";
import { cancelJob, getJob } from "../db/queries/jobs.js";
import { withProjectPolicyForTest } from "../db/queries/project-policy.js";
import {
  type DuplicateGroup,
  findDuplicateAudio,
} from "../db/queries/assets.js";
import { MAX_PAGE_SIZE } from "../db/queries/pagination.js";
import {
  projectScope,
  usageFor,
  userScope,
} from "../db/queries/storage-usage.js";
import {
  baseUrl,
  fakeWav,
  onDiskPath,
  servedAt,
  setupSuite,
  testImage,
  trustedOrigin,
} from "../test/fixtures.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../test/instance-policy.js";
import {
  makeAudible,
  settledJob,
  settleJobs,
  settleProjectJobs,
  writeTone,
} from "../test/media.js";

const suite = setupSuite("Assets");
const {
  editor,
  viewer,
  outsider,
  requireProject,
  request,
  expectAccess,
  mkTrack,
  mkCollection,
  mkSession,
  uploadAsset,
  uploadTypedAsset,
} = suite;

describe("assets", () => {
  it("uploads an asset, writes it to disk, and reads it back", async () => {
    requireProject();
    const asset = await uploadAsset("upload-me.jpeg");
    expect(asset.name).toBe("upload-me.jpeg");
    expect(asset.assetPath).toBeDefined();

    expect(existsSync(onDiskPath(asset.assetPath))).toBe(true);

    const list = await request("viewer", `/assets/project/${suite.projectId}`);
    expect(list.status).toBe(200);
    const { rows } = (await list.json()) as { rows: { id: number }[] };
    expect(rows.some((r) => r.id === asset.id)).toBe(true);
  });

  it("refuses a file named as audio whose bytes are not audio", async () => {
    requireProject();
    const upload = async (bytes: BlobPart, name: string) => {
      const form = new FormData();
      form.append("file", new File([bytes], name, { type: "audio/mpeg" }));
      form.append("projectId", String(suite.projectId));
      return app.request(`${baseUrl}/assets/upload`, {
        method: "POST",
        headers: { Cookie: suite.owner.cookie, Origin: trustedOrigin },
        body: form,
      });
    };

    const before = await request("owner", `/assets/project/${suite.projectId}`);
    const countBefore = ((await before.json()) as { rowCount: number })
      .rowCount;

    const disguised = await upload(await testImage(), "really-a-jpeg.mp3");
    expect(disguised.status).toBe(400);
    const after = await request("owner", `/assets/project/${suite.projectId}`);
    expect(((await after.json()) as { rowCount: number }).rowCount).toBe(
      countBefore
    );

    // Any audio signature passes, whatever the extension claims.
    const misnamed = await upload(fakeWav, "actually-a-wav.mp3");
    expect(misnamed.status).toBe(201);
  });

  describe("under the instance's upload policy", () => {
    afterEach(() => {
      restoreInstancePolicy();
    });

    const upload = (bytes: BlobPart, name: string) => {
      const form = new FormData();
      form.append("file", new File([bytes], name));
      form.append("projectId", String(suite.projectId));
      return app.request(`${baseUrl}/assets/upload`, {
        method: "POST",
        headers: { Cookie: suite.owner.cookie, Origin: trustedOrigin },
        body: form,
      });
    };

    it("holds each upload to the limit in force when it arrives", async () => {
      requireProject();
      // One KiB: a limit a test can pass without writing megabytes.
      stubInstancePolicy({ limits: { maxUploadMb: 1 / 1024 } });

      const over = await upload("x".repeat(1025), "over-the-limit.txt");
      expect(over.status).toBe(400);
      expect(await over.json()).toMatchObject({
        code: "invalid_request",
        details: {
          issues: [{ path: ["file"], code: "too_big", maximum: 1024 }],
        },
      });

      stubInstancePolicy({ limits: { maxUploadMb: 2 / 1024 } });
      const under = await upload(
        "x".repeat(1025),
        "under-the-raised-limit.txt"
      );
      expect(under.status).toBe(201);
    });

    it("refuses audio of a type the instance does not take, and leaves other files alone", async () => {
      requireProject();
      stubInstancePolicy({ limits: { audioTypes: [".flac"] } });

      const wav = await upload(fakeWav, "not-taken-here.wav");
      expect(wav.status).toBe(400);
      expect(await wav.json()).toMatchObject({
        error: "This instance does not take .wav uploads",
      });

      const attachment = await upload("notes", "liner-notes.txt");
      expect(attachment.status).toBe(201);
    });
  });

  it("accepts a real FLAC upload and serves it back inline as audio/flac", async () => {
    requireProject();
    const dir = await mkdtemp(join(tmpdir(), "assets-flac-"));
    try {
      const path = join(dir, "bounce.flac");
      await writeTone(path, { format: "flac" });
      const form = new FormData();
      form.append(
        "file",
        new File([await readFile(path)], "Take — Lab bounce.flac", {
          type: "audio/flac",
        })
      );
      form.append("projectId", String(suite.projectId));

      const res = await app.request(`${baseUrl}/assets/upload`, {
        method: "POST",
        headers: { Cookie: suite.owner.cookie, Origin: trustedOrigin },
        body: form,
      });
      expect(res.status).toBe(201);
      const asset = (await res.json()) as { assetPath: string; type: string };
      expect(asset.type).toBe("audio/flac");

      const served = await app.request(servedAt(asset.assetPath), {
        headers: { Cookie: viewer.cookie, Range: "bytes=0-3" },
      });
      expect(served.status).toBe(206);
      expect(served.headers.get("Content-Type")).toBe("audio/flac");
      // The em dash every bounce name carries is past Latin-1, so it can only
      // travel as the UTF-8 `filename*`.
      expect(served.headers.get("Content-Disposition")).toBe(
        `inline; filename="Take _ Lab bounce.flac"; filename*=UTF-8''Take%20%E2%80%94%20Lab%20bounce.flac`
      );
      expect(await served.text()).toBe("fLaC");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("carries localFile* metadata, leaving it null when omitted", async () => {
    requireProject();

    const created = Date.parse("2026-01-02T03:04:05.678Z");
    const updated = Date.parse("2026-02-03T04:05:06.789Z");

    const withMeta = await uploadAsset("meta.jpeg", {
      localFilepath: "/music/Song Project/Bounces/meta.jpeg",
      localFileCreatedAt: String(created),
      localFileUpdatedAt: String(updated),
      localFileMachineName: "workstation-1",
      fingerprint: `1024:${"a".repeat(40)}`,
    });
    expect(withMeta.localFilepath).toBe(
      "/music/Song Project/Bounces/meta.jpeg"
    );
    expect(Date.parse(withMeta.localFileCreatedAt!)).toBe(created);
    expect(Date.parse(withMeta.localFileUpdatedAt!)).toBe(updated);
    expect(withMeta.localFileMachineName).toBe("workstation-1");
    expect(withMeta.fingerprint).toBe(`1024:${"a".repeat(40)}`);

    const plain = await uploadAsset("plain.jpeg");
    expect(plain.localFilepath).toBeNull();
    expect(plain.localFileCreatedAt).toBeNull();
    expect(plain.localFileUpdatedAt).toBeNull();
    expect(plain.localFileMachineName).toBeNull();
    expect(plain.fingerprint).toBeNull();
  });

  it("reads one asset by id with its localFile* columns", async () => {
    requireProject();

    const uploaded = await uploadAsset("by-id.jpeg", {
      localFilepath: "/music/Song Project/Bounces/by-id.jpeg",
      localFileMachineName: "workstation-1",
    });

    const res = await request("viewer", `/assets/${uploaded.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof uploaded;
    expect(body.id).toBe(uploaded.id);
    expect(body.name).toBe("by-id.jpeg");
    expect(body.localFilepath).toBe("/music/Song Project/Bounces/by-id.jpeg");
    expect(body.localFileMachineName).toBe("workstation-1");
    expect(body).not.toHaveProperty("uploadedBy");
  });

  it("answers 404 for an unknown asset id, and gates the read by membership", async () => {
    requireProject();
    const asset = await uploadAsset("by-id-gated.jpeg");

    expect((await request("owner", "/assets/2147483000")).status).toBe(404);
    await expectAccess("GET", `/assets/${asset.id}`, { viewer: 200 });
  });

  it("looks up uploaded assets by fingerprint, with their sessions", async () => {
    requireProject();

    const stamp = Date.now();
    const attachedPrint = `2048:${stamp}-attached`;
    const loosePrint = `4096:${stamp}-loose`;

    const attached = await uploadAsset("fp-attached.jpeg", {
      fingerprint: attachedPrint,
    });
    const loose = await uploadAsset("fp-loose.jpeg", {
      fingerprint: loosePrint,
    });

    const session = await mkSession({ name: `fp-session-${stamp}` });
    const link = await request("owner", `/sessions/${session.id}/attachments`, {
      method: "POST",
      body: JSON.stringify({ assetId: attached.id }),
    });
    expect(link.status).toBe(201);

    const res = await request("owner", "/assets/lookup", {
      method: "POST",
      body: JSON.stringify({
        projectId: suite.projectId,
        fingerprints: [attachedPrint, loosePrint, `8192:${stamp}-absent`],
      }),
    });
    expect(res.status).toBe(200);

    const matches = (await res.json()) as {
      fingerprint: string;
      assetId: number;
      name: string;
      sessionIds: number[];
    }[];
    expect(matches).toHaveLength(2);

    const attachedMatch = matches.find((m) => m.fingerprint === attachedPrint)!;
    expect(attachedMatch.assetId).toBe(attached.id);
    expect(attachedMatch.name).toBe("fp-attached.jpeg");
    expect(attachedMatch.sessionIds).toEqual([session.id]);

    const looseMatch = matches.find((m) => m.fingerprint === loosePrint)!;
    expect(looseMatch.assetId).toBe(loose.id);
    expect(looseMatch.sessionIds).toEqual([]);

    const empty = await request("owner", "/assets/lookup", {
      method: "POST",
      body: JSON.stringify({ projectId: suite.projectId, fingerprints: [] }),
    });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual([]);
  });

  it("gates asset endpoints by role", async () => {
    requireProject();
    const asset = await uploadAsset("gated-asset.jpeg");

    await expectAccess("GET", `/assets/project/${suite.projectId}`, {
      viewer: 200,
    });
    // A lookup is a read that happens to be a POST, so a viewer passes it.
    await expectAccess(
      "POST",
      "/assets/lookup",
      { viewer: 200, editor: 200 },
      { projectId: suite.projectId, fingerprints: [] }
    );
    await expectAccess("DELETE", `/assets/${asset.id}`, {
      viewer: 403,
      editor: 204,
    });
  });

  /**
   * The mount lets a viewer post a lookup, and `/assets/upload` is a POST
   * under the same mount: it must keep needing an editor. Upload names its
   * project in the multipart body, so the gate reads the form rather than the
   * path.
   */
  it("a viewer still cannot upload", async () => {
    requireProject();

    const form = async () => {
      const f = new FormData();
      f.append(
        "file",
        new File([await testImage()], "gate.jpeg", {
          type: "image/jpeg",
        })
      );
      f.append("projectId", String(suite.projectId));
      return f;
    };

    const anon = await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: { Origin: trustedOrigin },
      body: await form(),
    });
    expect(anon.status).toBe(401);

    const stranger = await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: { Cookie: outsider.cookie, Origin: trustedOrigin },
      body: await form(),
    });
    expect(stranger.status).toBe(404);

    const viewerUpload = await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: { Cookie: viewer.cookie, Origin: trustedOrigin },
      body: await form(),
    });
    expect(viewerUpload.status).toBe(403);

    const editorUpload = await app.request(`${baseUrl}/assets/upload`, {
      method: "POST",
      headers: { Cookie: editor.cookie, Origin: trustedOrigin },
      body: await form(),
    });
    expect(editorUpload.status).toBe(201);
  });
});

describe("media spawning", () => {
  /**
   * The converted path used to be built by interpolating the upload's name
   * into a shell command, so a `;` in the name ran as a second command.
   * Nothing reaches a shell now: the whole path is one argv entry, ffmpeg
   * fails to open the file behind the name, and the job records the failure.
   */
  it("never runs an uploaded filename as a shell command", async () => {
    requireProject();
    const marker = "pwned-marker";
    const asset = await uploadAsset(`x;touch ${marker};.wav`);

    const res = await request("owner", `/assets/${asset.id}/convert`, {
      method: "POST",
      body: JSON.stringify({ format: ".mp3", kbps: 128 }),
    });
    expect(res.status).toBe(202);

    const { jobId } = (await res.json()) as { jobId: number };
    expect((await settledJob(suite, "owner", jobId)).status).toBe("failed");
    expect(existsSync(marker)).toBe(false);
  });

  it("lets an editor queue a conversion but not a viewer", async () => {
    requireProject();
    const source = await uploadAsset("gated-convert.wav");
    await makeAudible(source.assetPath);

    const jobIds: number[] = [];
    await expectAccess(
      "POST",
      `/assets/${source.id}/convert`,
      { viewer: 403, editor: 202 },
      { format: ".mp3", kbps: 128 },
      (body) => {
        const queued = body as { jobId: number };
        expect(queued.jobId).toBeTypeOf("number");
        jobIds.push(queued.jobId);
      }
    );

    await settleJobs(jobIds);
  });

  it("converts an asset into a gated asset of its own", async () => {
    requireProject();
    const source = await uploadAsset("bounce.wav");
    await makeAudible(source.assetPath);

    const res = await request("owner", `/assets/${source.id}/convert`, {
      method: "POST",
      body: JSON.stringify({ format: ".mp3", kbps: 128 }),
    });
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: number };

    const job = await settledJob(suite, "owner", jobId);
    expect(job.status).toBe("done");

    // A UUID under /static/assets, never a name derived from the upload.
    const url = job.result!.url!;
    expect(url).toMatch(/^\/static\/assets\/[0-9a-f-]{36}\.mp3$/);
    expect(existsSync(url.slice(1))).toBe(true);

    // The output is an asset in its own right, so it is listed and named ...
    const list = await request("viewer", `/assets/project/${suite.projectId}`);
    const { rows } = (await list.json()) as {
      rows: { id: number; name: string; assetPath: string }[];
    };
    const output = rows.find((row) => row.id === job.result!.assetId);
    expect(output?.name).toBe("bounce-128kbps.mp3");
    expect(servedAt(output!.assetPath)).toBe(url);

    // ... and gated on the project rather than served to anyone who has a URL.
    expect((await app.request(url)).status).toBe(401);
    expect(
      (await app.request(url, { headers: { Cookie: outsider.cookie } })).status
    ).toBe(403);
    expect(
      (await app.request(url, { headers: { Cookie: viewer.cookie } })).status
    ).toBe(200);

    // The source is left exactly as it was.
    const [original] = await db
      .select()
      .from(assets)
      .where(eq(assets.id, source.id));
    expect(original?.assetPath).toBe(source.assetPath);
  });

  it("converts to MP3 at the project's bitrate when the request names none", async () => {
    requireProject();
    const source = await uploadAsset("default-bitrate.wav");
    await makeAudible(source.assetPath);

    const res = await withProjectPolicyForTest(
      suite.projectId,
      { audio: { mp3Kbps: 96 } },
      () =>
        request("owner", `/assets/${source.id}/convert`, {
          method: "POST",
          body: JSON.stringify({ format: ".mp3" }),
        })
    );
    expect(res.status).toBe(202);
    const { jobId } = (await res.json()) as { jobId: number };

    const job = await settledJob(suite, "owner", jobId);
    expect(job.status).toBe("done");
    const [output] = await db
      .select({ name: assets.name })
      .from(assets)
      .where(eq(assets.id, job.result!.assetId!));
    expect(output?.name).toBe("default-bitrate-96kbps.mp3");
  });

  it("reports at least one intermediate percent while converting", async () => {
    requireProject();
    const source = await uploadAsset("progress.wav");
    // Long enough that encoding it takes measurably more than one report
    // interval, so `-progress pipe:1`'s `out_time_us` has time to land more
    // than the claim's initial write and the final `done`.
    await writeTone(onDiskPath(source.assetPath), { seconds: 60 });

    const percents: number[] = [];
    const unsubscribe = subscribeProject(suite.projectId, (job) => {
      if (job.subjectId === source.id && job.status === "running") {
        percents.push(job.percent);
      }
    });

    try {
      const res = await request("owner", `/assets/${source.id}/convert`, {
        method: "POST",
        body: JSON.stringify({ format: ".mp3", kbps: 128 }),
      });
      expect(res.status).toBe(202);
      const { jobId } = (await res.json()) as { jobId: number };

      const job = await settledJob(suite, "owner", jobId);
      expect(job.status).toBe("done");
    } finally {
      unsubscribe();
    }

    expect(percents.some((percent) => percent > 0 && percent < 100)).toBe(true);
  });

  it("removes the partial output file when a cancel lands mid-convert", async () => {
    requireProject();
    const source = await uploadAsset("cancel-convert.wav");
    // Long enough that a real intermediate percent lands before the cancel,
    // so ffmpeg has genuinely started writing the output when it is killed.
    await writeTone(onDiskPath(source.assetPath), { seconds: 600 });

    // The output's name is a fresh UUID, so the spy records the one path this
    // job writes. Diffing the shared `static/assets` directory against the
    // `assets` table instead would also catch another suite's upload between
    // its file write and its row insert, and fail on a file that is not ours.
    const encode = media.convertAudio;
    let outputPath: string | undefined;
    const convertSpy = spyOn(media, "convertAudio").mockImplementation(
      (input, output, ...rest) => {
        if (input.endsWith(source.assetPath)) outputPath = output;
        return encode(input, output, ...rest);
      }
    );

    let encodingStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      encodingStarted = resolve;
    });
    const unsubscribe = subscribeProject(suite.projectId, (job) => {
      if (
        job.subjectId === source.id &&
        job.status === "running" &&
        job.percent > 0
      ) {
        encodingStarted();
      }
    });

    try {
      const res = await request("owner", `/assets/${source.id}/convert`, {
        method: "POST",
        body: JSON.stringify({ format: ".mp3", kbps: 128 }),
      });
      expect(res.status).toBe(202);
      const { jobId } = (await res.json()) as { jobId: number };

      await started;
      await cancelJob(jobId);
      await settleJobs([jobId]);

      expect((await getJob(jobId)).status).toBe("cancelled");
    } finally {
      unsubscribe();
      convertSpy.mockRestore();
    }

    expect(outputPath).toBeDefined();
    expect(existsSync(outputPath!)).toBe(false);
  });

  it("rejects a non-audio asset without queueing anything", async () => {
    requireProject();
    const image = await uploadAsset("artwork.jpeg");

    const before = await request("viewer", `/projects/${suite.projectId}/jobs`);
    const countBefore = ((await before.json()) as unknown[]).length;

    const res = await request("owner", `/assets/${image.id}/convert`, {
      method: "POST",
      body: JSON.stringify({ format: ".mp3", kbps: 128 }),
    });
    expect(res.status).toBe(400);

    const after = await request("viewer", `/projects/${suite.projectId}/jobs`);
    expect(((await after.json()) as unknown[]).length).toBe(countBefore);
  });

  it("hands a repeat conversion the job that already did it", async () => {
    requireProject();
    const source = await uploadAsset("repeat.wav");
    await makeAudible(source.assetPath);

    const body = JSON.stringify({ format: ".mp3", kbps: 192 });
    const first = await request("owner", `/assets/${source.id}/convert`, {
      method: "POST",
      body,
    });
    const { jobId } = (await first.json()) as { jobId: number };
    await settledJob(suite, "owner", jobId);

    const listed = async () =>
      (
        (await (
          await request("viewer", `/assets/project/${suite.projectId}`)
        ).json()) as { rowCount: number }
      ).rowCount;
    const countBefore = await listed();

    const again = await request("owner", `/assets/${source.id}/convert`, {
      method: "POST",
      body,
    });
    expect(again.status).toBe(202);
    expect((await again.json()).jobId).toBe(jobId);

    await settleJobs([jobId]);
    expect(await listed()).toBe(countBefore);
  });

  it("records no bitrate for a lossless target, whatever the request said", async () => {
    requireProject();
    const source = await uploadAsset("lossless.wav");
    await makeAudible(source.assetPath);

    const first = await request("owner", `/assets/${source.id}/convert`, {
      method: "POST",
      body: JSON.stringify({ format: ".flac" }),
    });
    expect(first.status).toBe(202);
    const { jobId } = (await first.json()) as { jobId: number };

    const job = await settledJob(suite, "owner", jobId);
    expect(job.status).toBe("done");
    // A bitrate would be meaningless for FLAC, so neither the job nor the
    // output asset's name claims one.
    expect(job.result?.kbps).toBeNull();
    expect(job.result?.name).toBe("lossless.flac");

    // A kbps the encode cannot use must not fork the job it dedupes against.
    const again = await request("owner", `/assets/${source.id}/convert`, {
      method: "POST",
      body: JSON.stringify({ format: ".flac", kbps: 128 }),
    });
    expect(again.status).toBe(202);
    expect((await again.json()).jobId).toBe(jobId);
  });

  it("links an audio without waiting on its analysis", async () => {
    requireProject();
    const trackId = await mkTrack("Analysed Track");
    const asset = await uploadAsset("analysis.wav");
    await makeAudible(asset.assetPath);

    const link = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    expect(link.status).toBe(201);
    const {
      audios: [audio],
      analysisJobIds,
    } = (await link.json()) as {
      audios: { id: number; durationMs: number | null }[];
      analysisJobIds: number[];
    };
    expect(audio!.durationMs).toBeNull();

    await settleJobs(analysisJobIds);

    const track = await (await request("owner", `/tracks/${trackId}`)).json();
    expect(track.primaryAudio.durationMs).toBeCloseTo(500, -2);

    const peaks = await request(
      "owner",
      `/track-audios/${audio!.id}/measures/peaks`
    );
    expect(peaks.status).toBe(200);
    expect(
      ((await peaks.json()) as { value: number[] }).value.length
    ).toBeGreaterThan(0);
  });

  it("removes a track audio's spectrogram PNG when its asset is deleted", async () => {
    requireProject();
    const trackId = await mkTrack("Spectrogram Cleanup Track");
    const asset = await uploadAsset("spectrogram-cleanup.wav");
    await makeAudible(asset.assetPath);

    const link = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    await settleJobs((await link.json()).analysisJobIds);

    const [row] = await db
      .select({ spectrogramKey: trackAudios.spectrogramKey })
      .from(trackAudios)
      .where(eq(trackAudios.assetId, asset.id));
    expect(row?.spectrogramKey).toBeTruthy();
    expect(existsSync(onDiskPath(row!.spectrogramKey!))).toBe(true);

    const deleted = await request("owner", `/assets/${asset.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);

    // The asset's track-audio row cascades away with it, so the PNG it named
    // has to be cleaned up alongside the asset's own file rather than left
    // behind under `static/analysis/`.
    expect(existsSync(onDiskPath(row!.spectrogramKey!))).toBe(false);
  });
});

type AssetsPage = {
  rows: { id: number; name: string }[];
  rowCount: number;
  page: number;
  pageSize: number;
};

describe("paged project listing", () => {
  it("pages a project's files and reports the total", async () => {
    requireProject();
    const prefix = "paging-set";
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const asset = await uploadTypedAsset(
        `${prefix}-${i}.bin`,
        "application/octet-stream",
        new Uint8Array(4)
      );
      ids.push(asset.id);
    }

    const first = await request(
      "viewer",
      `/assets/project/${suite.projectId}?pageSize=2&q=${prefix}`
    );
    expect(first.status).toBe(200);
    const firstPage = (await first.json()) as AssetsPage;
    expect(firstPage.page).toBe(1);
    expect(firstPage.pageSize).toBe(2);
    expect(firstPage.rowCount).toBe(3);
    expect(firstPage.rows.map((r) => r.id)).toEqual(ids.slice(0, 2));

    const second = await request(
      "viewer",
      `/assets/project/${suite.projectId}?page=2&pageSize=2&q=${prefix}`
    );
    const secondPage = (await second.json()) as AssetsPage;
    expect(secondPage.rows.map((r) => r.id)).toEqual(ids.slice(2));
  });

  it("filters by name and counts the matches", async () => {
    requireProject();
    await uploadTypedAsset(
      "filter-mix-alpha.bin",
      "application/octet-stream",
      new Uint8Array(4)
    );
    await uploadTypedAsset(
      "filter-MIX-beta.bin",
      "application/octet-stream",
      new Uint8Array(4)
    );
    await uploadTypedAsset(
      "filter-other.bin",
      "application/octet-stream",
      new Uint8Array(4)
    );

    const res = await request(
      "viewer",
      `/assets/project/${suite.projectId}?q=filter-mix`
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as AssetsPage;
    expect(page.rowCount).toBe(2);
    expect(page.rows.every((r) => r.name.toLowerCase().includes("mix"))).toBe(
      true
    );

    // A literal `_` in the term must not act as a single-character wildcard.
    const underscore = await uploadTypedAsset(
      "escape_target.bin",
      "application/octet-stream",
      new Uint8Array(4)
    );
    await uploadTypedAsset(
      "escapeXtarget.bin",
      "application/octet-stream",
      new Uint8Array(4)
    );
    const escaped = await request(
      "viewer",
      `/assets/project/${suite.projectId}?q=escape_target`
    );
    const escapedPage = (await escaped.json()) as AssetsPage;
    expect(escapedPage.rows.map((r) => r.id)).toEqual([underscore.id]);
  });

  it("sorts by a whitelisted key and ignores any other", async () => {
    requireProject();
    const prefix = "sort-set";
    const small = await uploadTypedAsset(
      `${prefix}-small.bin`,
      "application/octet-stream",
      new Uint8Array(4)
    );
    const big = await uploadTypedAsset(
      `${prefix}-big.bin`,
      "application/octet-stream",
      new Uint8Array(40)
    );

    const bySize = await request(
      "viewer",
      `/assets/project/${suite.projectId}?q=${prefix}&sort=size.desc`
    );
    expect(bySize.status).toBe(200);
    const bySizePage = (await bySize.json()) as AssetsPage;
    expect(bySizePage.rows.map((r) => r.id)).toEqual([big.id, small.id]);

    // `nonsense` is outside the whitelist: `parseSort` returns null and the
    // order falls back to today's default (id ascending), not a 400.
    const bogus = await request(
      "viewer",
      `/assets/project/${suite.projectId}?q=${prefix}&sort=nonsense.asc`
    );
    expect(bogus.status).toBe(200);
    const bogusPage = (await bogus.json()) as AssetsPage;
    expect(bogusPage.rows.map((r) => r.id)).toEqual([small.id, big.id]);
  });

  it("clamps a pageSize over the maximum instead of rejecting it", async () => {
    requireProject();
    const tooLarge = await request(
      "viewer",
      `/assets/project/${suite.projectId}?pageSize=500`
    );
    expect(tooLarge.status).toBe(200);
    const tooLargePage = (await tooLarge.json()) as AssetsPage;
    expect(tooLargePage.pageSize).toBe(MAX_PAGE_SIZE);

    const zeroPage = await request(
      "viewer",
      `/assets/project/${suite.projectId}?page=0`
    );
    expect(zeroPage.status).toBe(400);
  });

  it("a page past the end is empty", async () => {
    requireProject();
    const whole = await request("viewer", `/assets/project/${suite.projectId}`);
    const wholePage = (await whole.json()) as AssetsPage;

    const res = await request(
      "viewer",
      `/assets/project/${suite.projectId}?page=9999&pageSize=25`
    );
    expect(res.status).toBe(200);
    const page = (await res.json()) as AssetsPage;
    expect(page.rows).toEqual([]);
    expect(page.rowCount).toBe(wholePage.rowCount);
  });
});

describe("bulk delete", () => {
  const bulkDelete = (payload: unknown, caller: "owner" | "editor" = "owner") =>
    request(caller, "/assets/bulk", {
      method: "DELETE",
      body: JSON.stringify(payload),
    });

  const assetExists = async (id: number) =>
    (await db.select({ id: assets.id }).from(assets).where(eq(assets.id, id)))
      .length === 1;

  it("deletes several files and reports the count", async () => {
    requireProject();
    const doomed = [
      await uploadAsset("bulk-doomed-a.jpeg"),
      await uploadAsset("bulk-doomed-b.jpeg"),
    ];
    const spared = await uploadAsset("bulk-spared.jpeg");

    // A 200 is also what says `/bulk` is registered ahead of `/:id`: the id
    // validator of that route would refuse `bulk` with a 400.
    const res = await bulkDelete({
      projectId: suite.projectId,
      ids: doomed.map((asset) => asset.id),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });

    for (const asset of doomed) expect(await assetExists(asset.id)).toBe(false);
    expect(await assetExists(spared.id)).toBe(true);
  });

  it("counts a repeated id once and skips one that names no file", async () => {
    requireProject();
    const asset = await uploadAsset("bulk-repeated.jpeg");

    const res = await bulkDelete({
      projectId: suite.projectId,
      ids: [asset.id, asset.id, 2_000_000_000],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });
    expect(await assetExists(asset.id)).toBe(false);
  });

  /**
   * The mount proves the caller may edit the project named in the body; it
   * says nothing about whose files the ids are. The project term in the
   * query's `where` is what stops an editor of one project from deleting
   * another's files.
   */
  it("does not delete a file that belongs to another project", async () => {
    requireProject();
    const other = await suite.throwawayProject("Foreign Files");
    const foreign = await uploadTypedAsset(
      "foreign-file.bin",
      "application/octet-stream",
      new Uint8Array(8),
      other.owner.cookie,
      other.id
    );
    const mine = await uploadAsset("bulk-mine.jpeg");

    const res = await bulkDelete({
      projectId: suite.projectId,
      ids: [mine.id, foreign.id],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });

    expect(await assetExists(mine.id)).toBe(false);
    expect(await assetExists(foreign.id)).toBe(true);
    expect(existsSync(onDiskPath(foreign.assetPath))).toBe(true);

    // Naming the other project instead does not help: the caller is not a
    // member of it, so the gate answers 404 before the handler runs.
    const named = await bulkDelete({
      projectId: other.id,
      ids: [foreign.id],
    });
    expect(named.status).toBe(404);
    expect(await assetExists(foreign.id)).toBe(true);
  });

  it("removes the stored files of what it deleted", async () => {
    requireProject();
    const doomed = [
      await uploadAsset("bulk-unlinked-a.jpeg"),
      await uploadAsset("bulk-unlinked-b.jpeg"),
    ];
    for (const asset of doomed) {
      expect(existsSync(onDiskPath(asset.assetPath))).toBe(true);
    }

    const res = await bulkDelete({
      projectId: suite.projectId,
      ids: doomed.map((asset) => asset.id),
    });
    expect(res.status).toBe(200);

    for (const asset of doomed) {
      expect(existsSync(onDiskPath(asset.assetPath))).toBe(false);
    }
  });

  it("removes the spectrogram of a track audio it cascades away", async () => {
    requireProject();
    const trackId = await mkTrack("Bulk Spectrogram Track");
    const asset = await uploadAsset("bulk-spectrogram.wav");
    await makeAudible(asset.assetPath);

    const link = await request("owner", `/tracks/${trackId}/audios`, {
      method: "POST",
      body: JSON.stringify({ assetIds: [asset.id] }),
    });
    await settleJobs((await link.json()).analysisJobIds);

    const [row] = await db
      .select({ spectrogramKey: trackAudios.spectrogramKey })
      .from(trackAudios)
      .where(eq(trackAudios.assetId, asset.id));
    expect(row?.spectrogramKey).toBeTruthy();
    expect(existsSync(onDiskPath(row!.spectrogramKey!))).toBe(true);

    const res = await bulkDelete({
      projectId: suite.projectId,
      ids: [asset.id],
    });
    expect(res.status).toBe(200);

    // The key is read before the delete cascades the track-audio row away:
    // once that row is gone nothing names the PNG any more.
    expect(existsSync(onDiskPath(row!.spectrogramKey!))).toBe(false);
  });

  /**
   * Two files from two uploaders in one call: the project counter has to move
   * by both, each account's by its own, and neither may be counted twice.
   */
  it("takes every deleted file's bytes off the project and each uploader", async () => {
    requireProject();
    // An analysis still running would move the project counter under the
    // measurement below.
    await settleProjectJobs(suite.projectId);

    const sized = async (name: string, cookie?: string) =>
      (await uploadAsset(name, {}, cookie)) as unknown as {
        id: number;
        size: number;
      };
    const mine = await sized("bulk-counted-owner.jpeg");
    const theirs = await sized("bulk-counted-editor.jpeg", editor.cookie);

    const before = {
      project: await usageFor(projectScope(suite.projectId)),
      owner: await usageFor(userScope(suite.owner.userId)),
      editor: await usageFor(userScope(editor.userId)),
    };

    const res = await bulkDelete({
      projectId: suite.projectId,
      ids: [mine.id, theirs.id],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 2 });

    expect(
      before.project - (await usageFor(projectScope(suite.projectId)))
    ).toBe(mine.size + theirs.size);
    expect(before.owner - (await usageFor(userScope(suite.owner.userId)))).toBe(
      mine.size
    );
    expect(before.editor - (await usageFor(userScope(editor.userId)))).toBe(
      theirs.size
    );
  });

  it("a viewer is refused", async () => {
    requireProject();
    const asset = await uploadAsset("bulk-gated.jpeg");

    await expectAccess(
      "DELETE",
      "/assets/bulk",
      { viewer: 403, editor: 200 },
      { projectId: suite.projectId, ids: [asset.id] }
    );

    // The editor's allowed call is the one that removed it.
    expect(await assetExists(asset.id)).toBe(false);
  });

  it("refuses an empty id list and one past the cap", async () => {
    requireProject();

    const empty = await bulkDelete({ projectId: suite.projectId, ids: [] });
    expect(empty.status).toBe(400);

    const tooMany = await bulkDelete({
      projectId: suite.projectId,
      ids: Array.from({ length: 501 }, (_, i) => i + 1),
    });
    expect(tooMany.status).toBe(400);
  });
});

describe("duplicate audio", () => {
  const MINUTE = 60 * 1000;
  const bounceAt = Date.UTC(2026, 0, 1, 12);

  /**
   * Every test exports into a folder of its own: the whole file shares one
   * project, and the audit groups across all of it.
   */
  let folderCounter = 0;
  const bounceFolder = () =>
    `/Users/producer/Bounces/dupes-${Date.now()}-${folderCounter++}/`;

  const scanned = (
    folder: string,
    name: string,
    minutesIn = 0,
    machine = "Studio Mac"
  ) =>
    uploadAsset(name, {
      localFilepath: `${folder}${name}`,
      localFileMachineName: machine,
      localFileUpdatedAt: String(bounceAt + minutesIn * MINUTE),
    });

  const duplicates = async () => {
    const res = await request(
      "viewer",
      `/assets/project/${suite.projectId}/duplicates`
    );
    expect(res.status).toBe(200);
    return ((await res.json()) as { groups: DuplicateGroup[] }).groups;
  };

  const groupWith = (groups: DuplicateGroup[], id: number) =>
    groups.find((group) =>
      [group.kept, ...group.remove, ...group.skipped].some(
        (file) => file.id === id
      )
    );

  const removeDuplicates = (
    ids: number[],
    caller: "owner" | "editor" = "owner"
  ) =>
    request(caller, `/assets/project/${suite.projectId}/duplicates/remove`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    });

  const assetExists = async (id: number) =>
    (await db.select({ id: assets.id }).from(assets).where(eq(assets.id, id)))
      .length === 1;

  const attachToSession = async (assetId: number) => {
    const session = await mkSession({ name: `dupes-session-${assetId}` });
    const res = await request("owner", `/sessions/${session.id}/attachments`, {
      method: "POST",
      body: JSON.stringify({ assetId }),
    });
    expect(res.status).toBe(201);
  };

  /** Versions written straight to the rows: no analysis is needed to exist. */
  const addVersions = async (
    trackId: number,
    assetIds: number[],
    primary: number
  ) =>
    db
      .insert(trackAudios)
      .values(
        assetIds.map((assetId, i) => ({
          trackId,
          assetId,
          version: i + 1,
          isPrimary: assetId === primary,
        }))
      )
      .returning({ id: trackAudios.id, assetId: trackAudios.assetId });

  /**
   * A copy that is a version of a track beside the file kept in its place,
   * with the kept file's version primary unless `copyIsPrimary`.
   */
  const copyOnTrack = async (name: string, copyIsPrimary = false) => {
    const folder = bounceFolder();
    const wav = await scanned(folder, `${name}.wav`);
    const mp3 = await scanned(folder, `${name}.mp3`);
    const trackId = await mkTrack(`Dupes ${name} Track`);
    const versions = await addVersions(
      trackId,
      [wav.id, mp3.id],
      copyIsPrimary ? mp3.id : wav.id
    );
    const versionOf = (assetId: number) =>
      versions.find((row) => row.assetId === assetId)!.id;
    return {
      wav,
      mp3,
      trackId,
      keptVersionId: versionOf(wav.id),
      copyVersionId: versionOf(mp3.id),
    };
  };

  /**
   * Holds the first statement whose text `matches` once it has run, until
   * `release`: the transaction it ran in keeps every lock taken so far while
   * the test starts another one against it. Spied on the pooled client, since
   * a transaction's statements never reach the pool's own `query`.
   */
  const holdAfter = (matches: (text: string) => boolean) => {
    const query = pg.Client.prototype.query as (
      ...args: unknown[]
    ) => Promise<unknown>;
    let reached!: () => void;
    const held = new Promise<void>((resolve, reject) => {
      reached = resolve;
      setTimeout(
        () => reject(new Error("the held statement never ran")),
        5000
      ).unref();
    });
    let open!: () => void;
    const released = new Promise<void>((resolve) => (open = resolve));
    let armed = true;

    const spy = spyOn(pg.Client.prototype, "query").mockImplementation(
      function (this: pg.Client, ...args: unknown[]) {
        const result = query.apply(this, args);
        const arg = args[0] as string | { text?: string } | undefined;
        const text = typeof arg === "string" ? arg : arg?.text;
        if (!armed || typeof text !== "string" || !matches(text)) return result;
        armed = false;
        return result.then(async (value) => {
          reached();
          await released;
          return value;
        });
      } as never
    );

    return {
      held,
      release: () => {
        open();
        spy.mockRestore();
      },
    };
  };

  /**
   * Whether a statement containing `fragment` is waiting on a lock. Read from
   * the lock table rather than the waiter's own `wait_event`, which it clears
   * only once it runs again, so a wait whose holder has just committed never
   * reads as one still going.
   */
  const waitingOnLock = async (fragment: string) => {
    const { rows } = await db.execute<{ waiting: boolean }>(sql`
      select exists (
        select 1 from pg_stat_activity
        where datname = current_database()
          and cardinality(pg_blocking_pids(pid)) > 0
          and query like ${`%${fragment}%`}
      ) as waiting
    `);
    return rows[0]?.waiting === true;
  };

  const untilWaiting = (fragment: string) =>
    waitFor(async () => expect(await waitingOnLock(fragment)).toBe(true), {
      timeout: 3000,
    });

  /** The audit's own statement: the removal has judged every copy by then. */
  const isAudit = (text: string) => text.includes("with pair (copy_id");

  /** Room for a held transaction and the lock waits behind it, under load. */
  const RACE_TIMEOUT = 15_000;

  it("groups a wav and an mp3 of one bounce and keeps the lossless one", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Night Drive.wav");
    const mp3 = await scanned(folder, "night drive.mp3", 1.5);

    const group = groupWith(await duplicates(), wav.id);
    expect(group?.kept.id).toBe(wav.id);
    expect(group?.remove.map((file) => file.id)).toEqual([mp3.id]);
    expect(group?.skipped).toEqual([]);
  });

  it("keeps the largest file whatever its format", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Big Master.wav");
    const mp3 = await scanned(folder, "Big Master.mp3");
    await db
      .update(assets)
      .set({ size: 1_000_000 })
      .where(eq(assets.id, mp3.id));

    const group = groupWith(await duplicates(), mp3.id);
    expect(group?.kept.id).toBe(mp3.id);
    expect(group?.remove.map((file) => file.id)).toEqual([wav.id]);
  });

  it("keeps the file whose path sorts first when size and format tie, whichever was uploaded first", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Tie Master.wav");
    const flac = await scanned(folder, "Tie Master.flac");
    await db
      .update(assets)
      .set({ size: 4_000 })
      .where(inArray(assets.id, [wav.id, flac.id]));

    const group = groupWith(await duplicates(), wav.id);
    expect(group?.kept.id).toBe(flac.id);
    expect(group?.remove.map((file) => file.id)).toEqual([wav.id]);
  });

  it("keeps the lossless file over a larger lossy one where the project keeps lossless", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Lossless Master.wav");
    const mp3 = await scanned(folder, "Lossless Master.mp3");
    await db
      .update(assets)
      .set({ size: 1_000_000 })
      .where(eq(assets.id, mp3.id));

    const group = groupWith(
      await withProjectPolicyForTest(
        suite.projectId,
        { audio: { duplicateKeep: "lossless" } },
        duplicates
      ),
      wav.id
    );
    expect(group?.kept.id).toBe(wav.id);
    expect(group?.remove.map((file) => file.id)).toEqual([mp3.id]);
  });

  it("groups exports as far apart as the project's same-bounce window allows", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Slow Export.wav");
    const mp3 = await scanned(folder, "Slow Export.mp3", 5);

    expect(groupWith(await duplicates(), wav.id)).toBeUndefined();

    const widened = groupWith(
      await withProjectPolicyForTest(
        suite.projectId,
        { audio: { sameBounceWindowMinutes: 10 } },
        duplicates
      ),
      wav.id
    );
    expect(widened?.remove.map((file) => file.id)).toEqual([mp3.id]);
  });

  it("chains exports within two minutes of each other into one bounce", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Chain.wav");
    const flac = await scanned(folder, "Chain.flac", 2);
    const mp3 = await scanned(folder, "Chain.mp3", 4);

    const group = groupWith(await duplicates(), wav.id);
    expect(group?.kept.id).toBe(flac.id);
    expect(group?.remove.map((file) => file.id).sort()).toEqual(
      [wav.id, mp3.id].sort()
    );
  });

  it("does not group exports ten minutes apart", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Later Take.wav");
    await scanned(folder, "Later Take.mp3", 10);

    expect(groupWith(await duplicates(), wav.id)).toBeUndefined();
  });

  it("does not group exports from different machines", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Two Rigs.wav", 0, "Studio Mac");
    await scanned(folder, "Two Rigs.mp3", 0, "Laptop");

    expect(groupWith(await duplicates(), wav.id)).toBeUndefined();
  });

  it("does not group one file exported again, however soon after", async () => {
    requireProject();
    const folder = bounceFolder();
    const first = await scanned(folder, "Remix.wav");
    await scanned(folder, "Remix.wav", 1.5);

    expect(groupWith(await duplicates(), first.id)).toBeUndefined();
  });

  it("splits both formats exported twice into two bounces", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav1 = await scanned(folder, "Twice.wav");
    const mp31 = await scanned(folder, "Twice.mp3", 0.5);
    const wav2 = await scanned(folder, "Twice.wav", 1.5);
    const mp32 = await scanned(folder, "Twice.mp3", 2);

    const groups = await duplicates();
    expect(groupWith(groups, wav1.id)?.remove.map((f) => f.id)).toEqual([
      mp31.id,
    ]);
    expect(groupWith(groups, wav2.id)?.remove.map((f) => f.id)).toEqual([
      mp32.id,
    ]);
  });

  it("does not group web uploads, which carry no local path", async () => {
    requireProject();
    const wav = await uploadAsset("Web Upload.wav");
    await uploadAsset("Web Upload.mp3");

    expect(groupWith(await duplicates(), wav.id)).toBeUndefined();
  });

  it("skips a copy attached to a session the kept file is not on as in use", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Attached.wav");
    const mp3 = await scanned(folder, "Attached.mp3");
    await attachToSession(mp3.id);

    const group = groupWith(await duplicates(), wav.id);
    expect(group?.remove).toEqual([]);
    expect(group?.skipped).toEqual([
      expect.objectContaining({ id: mp3.id, reason: "in-use" }),
    ]);
  });

  it("skips a copy that is a version of a track the kept file is not", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Versioned.wav");
    const mp3 = await scanned(folder, "Versioned.mp3");
    const trackId = await mkTrack("Dupes Versioned Track");
    await addVersions(trackId, [mp3.id], mp3.id);

    const group = groupWith(await duplicates(), wav.id);
    expect(group?.skipped).toEqual([
      expect.objectContaining({ id: mp3.id, reason: "in-use" }),
    ]);
  });

  it("skips a copy whose version has comments", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Commented.wav");
    const mp3 = await scanned(folder, "Commented.mp3");
    const trackId = await mkTrack("Dupes Commented Track");
    const versions = await addVersions(trackId, [wav.id, mp3.id], wav.id);
    const mp3Version = versions.find((row) => row.assetId === mp3.id)!;

    const comment = await request("owner", "/comments", {
      method: "POST",
      body: JSON.stringify({
        targetType: "track_audio",
        targetId: mp3Version.id,
        content: "the low end is muddy here",
      }),
    });
    expect(comment.status).toBe(201);

    const group = groupWith(await duplicates(), wav.id);
    expect(group?.remove).toEqual([]);
    expect(group?.skipped).toEqual([
      expect.objectContaining({ id: mp3.id, reason: "commented" }),
    ]);
  });

  it("skips a copy whose version a snapshot share pins as shared", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Pinned.wav");
    const mp3 = await scanned(folder, "Pinned.mp3");
    const trackId = await mkTrack("Dupes Pinned Track");
    const versions = await addVersions(trackId, [wav.id, mp3.id], wav.id);
    const mp3Version = versions.find((row) => row.assetId === mp3.id)!;
    const [share] = await db
      .insert(sharelinks)
      .values({
        token: `dupes-pinned-${Date.now()}`,
        entityType: "track",
        entityId: trackId,
        shareType: "snapshot",
      })
      .returning({ id: sharelinks.id });
    await db
      .insert(sharelinkSnapshotTrackAudios)
      .values({ sharelinkId: share!.id, trackAudioId: mp3Version.id });

    const group = groupWith(await duplicates(), wav.id);
    expect(group?.remove).toEqual([]);
    expect(group?.skipped).toEqual([
      expect.objectContaining({ id: mp3.id, reason: "shared" }),
    ]);
  });

  it("removes a copy pinned only by a snapshot share that was turned off", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Revoked Pin.wav");
    const mp3 = await scanned(folder, "Revoked Pin.mp3");
    const trackId = await mkTrack("Dupes Revoked Pin Track");
    const versions = await addVersions(trackId, [wav.id, mp3.id], wav.id);
    const mp3Version = versions.find((row) => row.assetId === mp3.id)!;
    const [share] = await db
      .insert(sharelinks)
      .values({
        token: `dupes-revoked-pin-${Date.now()}`,
        entityType: "track",
        entityId: trackId,
        shareType: "snapshot",
        revokedAt: new Date(),
      })
      .returning({ id: sharelinks.id });
    await db
      .insert(sharelinkSnapshotTrackAudios)
      .values({ sharelinkId: share!.id, trackAudioId: mp3Version.id });

    const group = groupWith(await duplicates(), wav.id);
    expect(group?.skipped).toEqual([]);
    expect(group?.remove).toEqual([expect.objectContaining({ id: mp3.id })]);
  });

  it("judges every copy when the pairs span several statements", async () => {
    requireProject();
    const plain = bounceFolder();
    const wav = await scanned(plain, "Batched.wav");
    const mp3 = await scanned(plain, "Batched.mp3");
    const used = bounceFolder();
    const usedWav = await scanned(used, "Batched Used.wav");
    const usedMp3 = await scanned(used, "Batched Used.mp3");
    await attachToSession(usedMp3.id);

    // One pair per statement.
    setBindParamLimitForTest(1);
    try {
      const groups = await duplicates();
      expect(groupWith(groups, wav.id)?.remove.map((f) => f.id)).toEqual([
        mp3.id,
      ]);
      expect(groupWith(groups, usedWav.id)?.skipped).toEqual([
        expect.objectContaining({ id: usedMp3.id, reason: "in-use" }),
      ]);
    } finally {
      setBindParamLimitForTest(undefined);
    }
  });

  it("deletes only the ids still removable and hands the primary to the kept file", async () => {
    requireProject();
    const folder = bounceFolder();
    const wav = await scanned(folder, "Primary.wav");
    const mp3 = await scanned(folder, "Primary.mp3");
    const trackId = await mkTrack("Dupes Primary Track");
    const versions = await addVersions(trackId, [wav.id, mp3.id], mp3.id);
    const wavVersion = versions.find((row) => row.assetId === wav.id)!;

    // Removable when previewed, then attached before the removal lands.
    const staleWav = await scanned(folder, "Stale.wav");
    const staleMp3 = await scanned(folder, "Stale.mp3");
    const preview = await duplicates();
    expect(groupWith(preview, mp3.id)?.remove.map((f) => f.id)).toEqual([
      mp3.id,
    ]);
    expect(groupWith(preview, staleMp3.id)?.remove.map((f) => f.id)).toEqual([
      staleMp3.id,
    ]);
    await attachToSession(staleMp3.id);

    // The kept file itself is never removable, whatever the body says.
    const res = await removeDuplicates([mp3.id, staleMp3.id, wav.id]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 1 });

    expect(await assetExists(mp3.id)).toBe(false);
    expect(existsSync(onDiskPath(mp3.assetPath))).toBe(false);
    expect(await assetExists(wav.id)).toBe(true);
    expect(await assetExists(staleWav.id)).toBe(true);
    expect(await assetExists(staleMp3.id)).toBe(true);

    const left = await db
      .select({ id: trackAudios.id, isPrimary: trackAudios.isPrimary })
      .from(trackAudios)
      .where(eq(trackAudios.trackId, trackId));
    expect(left).toEqual([{ id: wavVersion.id, isPrimary: true }]);
  });

  it(
    "holds a comment on a copy's version until the removal commits, then answers 404",
    async () => {
      requireProject();
      const { mp3, copyVersionId } = await copyOnTrack("Racing Comment");

      const hold = holdAfter(isAudit);
      try {
        const removal = removeDuplicates([mp3.id]);
        await hold.held;

        const comment = request("owner", "/comments", {
          method: "POST",
          body: JSON.stringify({
            targetType: "track_audio",
            targetId: copyVersionId,
            content: "posted while the copy was being removed",
          }),
        });
        await untilWaiting("for share");
        hold.release();

        expect(await (await removal).json()).toEqual({ deleted: 1 });
        expect((await comment).status).toBe(404);
      } finally {
        hold.release();
      }

      const left = await db
        .select({ id: comments.id })
        .from(comments)
        .where(
          and(
            eq(comments.targetType, "track_audio"),
            eq(comments.targetId, copyVersionId)
          )
        );
      expect(left).toEqual([]);
    },
    RACE_TIMEOUT
  );

  it(
    "keeps a copy whose comment was mid-commit when the removal began",
    async () => {
      requireProject();
      const { mp3, copyVersionId } = await copyOnTrack("Committing Comment");

      const hold = holdAfter((text) => text.includes("for share"));
      try {
        const comment = request("owner", "/comments", {
          method: "POST",
          body: JSON.stringify({
            targetType: "track_audio",
            targetId: copyVersionId,
            content: "posted just before the removal",
          }),
        });
        await hold.held;

        const removal = removeDuplicates([mp3.id]);
        await untilWaiting('for update of "track_audios"');
        hold.release();

        expect((await comment).status).toBe(201);
        expect(await (await removal).json()).toEqual({ deleted: 0 });
      } finally {
        hold.release();
      }
      expect(await assetExists(mp3.id)).toBe(true);
    },
    RACE_TIMEOUT
  );

  it(
    "holds a snapshot pin of a copy's version until the removal commits, then answers as if it had gone first",
    async () => {
      requireProject();
      const { mp3, trackId, copyVersionId } =
        await copyOnTrack("Racing Snapshot");

      const hold = holdAfter(isAudit);
      try {
        const removal = removeDuplicates([mp3.id]);
        await hold.held;

        const pin = request("owner", "/share/snapshot", {
          method: "POST",
          body: JSON.stringify({
            entityType: "track",
            entityId: trackId,
            snapshotOverrides: {
              title: "Racing Snapshot",
              trackAudios: [{ id: copyVersionId }],
            },
          }),
        });
        await untilWaiting('insert into "sharelink_snapshot_track_audios"');
        hold.release();

        expect(await (await removal).json()).toEqual({ deleted: 1 });
        const answer = await pin;
        expect(answer.status).toBe(400);
        expect((await answer.json()).error).toBe(
          `Track audio ${copyVersionId} is not part of this track`
        );
      } finally {
        hold.release();
      }
      expect(await assetExists(mp3.id)).toBe(false);

      const links = await db
        .select({ id: sharelinks.id })
        .from(sharelinks)
        .where(
          and(
            eq(sharelinks.entityType, "track"),
            eq(sharelinks.entityId, trackId)
          )
        );
      expect(links).toEqual([]);
    },
    RACE_TIMEOUT
  );

  it(
    "answers a snapshot pin that loses to a second removal on its rerun as a conflict",
    async () => {
      requireProject();
      // Each copy is its track's primary, so a snapshot of the collection's
      // live versions pins both. Pins are inserted in ascending version order:
      // the first attempt waits on the first copy's removal alone.
      const first = await copyOnTrack("Twice Raced One", true);
      const second = await copyOnTrack("Twice Raced Two", true);
      expect(first.copyVersionId).toBeLessThan(second.copyVersionId);

      const collectionId = await mkCollection("Twice Raced");
      for (const [index, trackId] of [
        first.trackId,
        second.trackId,
      ].entries()) {
        const added = await request(
          "owner",
          `/collections/${collectionId}/tracks`,
          {
            method: "POST",
            body: JSON.stringify({ trackId, trackNumber: index + 1 }),
          }
        );
        expect(added.status).toBe(200);
      }

      // The second removal is held by a lock on the version it hands the
      // primary to, which it reaches with its copy's version already locked;
      // the one statement hold `holdAfter` gives goes to the first removal.
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      let unblock!: () => void;
      const unblocked = new Promise<void>((resolve) => (unblock = resolve));
      const blocker = db.transaction(async (tx) => {
        await tx
          .select({ id: trackAudios.id })
          .from(trackAudios)
          .where(eq(trackAudios.id, second.keptVersionId))
          .for("update");
        locked();
        await unblocked;
      });

      let hold: ReturnType<typeof holdAfter> | undefined;
      try {
        await lockTaken;
        const secondRemoval = removeDuplicates([second.mp3.id]);
        await untilWaiting('update "track_audios" set');

        hold = holdAfter(isAudit);
        const firstRemoval = removeDuplicates([first.mp3.id]);
        await hold.held;

        const pin = request("owner", "/share/snapshot", {
          method: "POST",
          body: JSON.stringify({
            entityType: "collection",
            entityId: collectionId,
          }),
        });
        await untilWaiting('insert into "sharelink_snapshot_track_audios"');
        hold.release();

        // With the first removal committed, only the second can hold up a pin:
        // the rerun has read its copy's version as still there.
        expect(await (await firstRemoval).json()).toEqual({ deleted: 1 });
        await untilWaiting('insert into "sharelink_snapshot_track_audios"');
        unblock();

        expect(await (await secondRemoval).json()).toEqual({ deleted: 1 });
        const answer = await pin;
        expect(answer.status).toBe(409);
        expect((await answer.json()).error).toBe(
          "The share's tracks changed while it was being saved. Try again."
        );
      } finally {
        hold?.release();
        unblock();
        await blocker;
      }

      const links = await db
        .select({ id: sharelinks.id })
        .from(sharelinks)
        .where(
          and(
            eq(sharelinks.entityType, "collection"),
            eq(sharelinks.entityId, collectionId)
          )
        );
      expect(links).toEqual([]);
    },
    RACE_TIMEOUT
  );

  it(
    "holds an attach of a copy's asset until the removal commits, then answers the missing-asset 404",
    async () => {
      requireProject();
      const { mp3, trackId } = await copyOnTrack("Racing Attach");

      const hold = holdAfter(isAudit);
      try {
        const removal = removeDuplicates([mp3.id]);
        await hold.held;

        const attach = request("owner", `/tracks/${trackId}/attachments`, {
          method: "POST",
          body: JSON.stringify({ assetId: mp3.id }),
        });
        await untilWaiting('insert into "track_attachments"');
        hold.release();

        expect(await (await removal).json()).toEqual({ deleted: 1 });
        const answer = await attach;
        expect(answer.status).toBe(404);
        expect((await answer.json()).error).toBe(
          "Asset not found in this project"
        );
      } finally {
        hold.release();
      }
    },
    RACE_TIMEOUT
  );

  it(
    "finishes a removal and a delete of the same copy one after the other rather than deadlocking",
    async () => {
      requireProject();
      const { mp3 } = await copyOnTrack("Racing Delete");

      // Held once the removal has its asset rows and nothing else, so the
      // delete reaches for the track before the removal does.
      const hold = holdAfter(
        (text) => text.includes('from "assets"') && text.includes("for update")
      );
      try {
        const removal = removeDuplicates([mp3.id]);
        await hold.held;

        const deleted = request("owner", `/assets/${mp3.id}`, {
          method: "DELETE",
        });
        await untilWaiting('from "assets"');
        hold.release();

        expect(await (await removal).json()).toEqual({ deleted: 1 });
        expect((await deleted).status).toBe(404);
      } finally {
        hold.release();
      }
    },
    RACE_TIMEOUT
  );

  /**
   * A track of two versions, the kept one first in both row and version
   * order: a statement rewriting the whole track reaches the kept version's
   * row before the doomed one's, and a delete of the doomed version then has
   * to renumber the kept one. `spare` is a third file, not yet linked.
   */
  const trackWithKeptAndDoomedVersions = async (name: string) => {
    const folder = bounceFolder();
    const kept = await scanned(folder, `${name}.wav`);
    const doomed = await scanned(folder, `${name}.mp3`);
    const spare = await scanned(folder, `${name}-spare.wav`);
    const trackId = await mkTrack(`Dupes ${name} Track`);
    const [keptVersion] = await addVersions(
      trackId,
      [kept.id, doomed.id],
      kept.id
    );
    return { trackId, doomed, spare, keptVersionId: keptVersion!.id };
  };

  /**
   * Deletes the doomed asset and holds it once it has locked its versions,
   * runs `interloper` against the same track, and releases: the two must
   * queue rather than deadlock.
   */
  const raceDeleteAgainst = async (
    doomedId: number,
    interloper: () => Promise<Response>
  ) => {
    const hold = holdAfter((text) =>
      text.includes('for update of "track_audios"')
    );
    try {
      const deleted = request("owner", `/assets/${doomedId}`, {
        method: "DELETE",
      });
      await hold.held;

      const other = interloper();
      await waitFor(
        async () =>
          expect(
            (await waitingOnLock("pg_advisory_xact_lock")) ||
              (await waitingOnLock('update "track_audios"'))
          ).toBe(true),
        { timeout: 3000 }
      );
      hold.release();

      expect((await deleted).status).toBe(204);
      return await other;
    } finally {
      hold.release();
    }
  };

  it(
    "queues a link of a version behind a delete of another version of the track rather than deadlocking",
    async () => {
      requireProject();
      const { trackId, doomed, spare, keptVersionId } =
        await trackWithKeptAndDoomedVersions("Racing Link");

      const link = await raceDeleteAgainst(doomed.id, () =>
        request("owner", `/tracks/${trackId}/audios`, {
          method: "POST",
          body: JSON.stringify({ assetIds: [spare.id] }),
        })
      );

      expect(link.status).toBe(201);
      const left = await db
        .select({ id: trackAudios.id, version: trackAudios.version })
        .from(trackAudios)
        .where(eq(trackAudios.trackId, trackId))
        .orderBy(trackAudios.version);
      expect(left.map((row) => row.version)).toEqual([1, 2]);
      expect(left[0]!.id).toBe(keptVersionId);
    },
    RACE_TIMEOUT
  );

  it(
    "queues setting the primary behind a delete of another version of the track rather than deadlocking",
    async () => {
      requireProject();
      const { trackId, doomed, keptVersionId } =
        await trackWithKeptAndDoomedVersions("Racing Primary");

      const setPrimary = await raceDeleteAgainst(doomed.id, () =>
        request("owner", `/track-audios/${keptVersionId}/primary`, {
          method: "PATCH",
        })
      );

      expect(setPrimary.status).toBe(200);
      const left = await db
        .select({ id: trackAudios.id, isPrimary: trackAudios.isPrimary })
        .from(trackAudios)
        .where(eq(trackAudios.trackId, trackId));
      expect(left).toEqual([{ id: keptVersionId, isPrimary: true }]);
    },
    RACE_TIMEOUT
  );

  const trackDeletes = [
    [
      "a delete of a track",
      204,
      (trackId: number) =>
        request("owner", `/tracks/${trackId}`, { method: "DELETE" }),
    ],
    [
      "a bulk delete of tracks",
      200,
      (trackId: number) =>
        request("owner", "/tracks/bulk", {
          method: "DELETE",
          body: JSON.stringify({
            projectId: suite.projectId,
            selection: { ids: [trackId] },
          }),
        }),
    ],
  ] as const;

  it.each(trackDeletes)(
    "queues %s behind an unlink of one of its versions rather than deadlocking",
    async (_name, deletedStatus, deleteTrack) => {
      requireProject();
      const { trackId, doomed } = await trackWithKeptAndDoomedVersions(
        "Racing Track Delete"
      );
      const [doomedVersion] = await db
        .select({ id: trackAudios.id })
        .from(trackAudios)
        .where(eq(trackAudios.assetId, doomed.id));

      // Held once the unlink has deleted its version: it holds the track's
      // lock and that row, and is yet to renumber the kept version, which a
      // delete of the track that reached the kept version first would hold.
      const hold = holdAfter((text) =>
        text.includes('delete from "track_audios"')
      );
      try {
        const unlinked = request(
          "owner",
          `/track-audios/${doomedVersion!.id}`,
          {
            method: "DELETE",
          }
        );
        await hold.held;

        const deleted = deleteTrack(trackId);
        await waitFor(
          async () =>
            expect(
              (await waitingOnLock("pg_advisory_xact_lock")) ||
                (await waitingOnLock('delete from "tracks"'))
            ).toBe(true),
          { timeout: 3000 }
        );
        hold.release();

        expect((await unlinked).status).toBe(204);
        expect((await deleted).status).toBe(deletedStatus);
      } finally {
        hold.release();
      }

      const left = await db
        .select({ id: trackAudios.id })
        .from(trackAudios)
        .where(eq(trackAudios.trackId, trackId));
      expect(left).toEqual([]);
    },
    RACE_TIMEOUT
  );

  it.each(trackDeletes)(
    "queues %s behind a link of a version rather than deadlocking",
    async (_name, deletedStatus, deleteTrack) => {
      requireProject();
      const { trackId, spare } =
        await trackWithKeptAndDoomedVersions("Racing Link Delete");

      // Held once the link has inserted its version: that insert holds the
      // track's row through its foreign key, which the track delete must
      // delete, so the link must already hold the track's lock by then.
      const hold = holdAfter((text) =>
        text.includes('insert into "track_audios"')
      );
      try {
        const linked = request("owner", `/tracks/${trackId}/audios`, {
          method: "POST",
          body: JSON.stringify({ assetIds: [spare.id] }),
        });
        await hold.held;

        const deleted = deleteTrack(trackId);
        await waitFor(
          async () =>
            expect(
              (await waitingOnLock("pg_advisory_xact_lock")) ||
                (await waitingOnLock('delete from "tracks"'))
            ).toBe(true),
          { timeout: 3000 }
        );
        hold.release();

        expect((await linked).status).toBe(201);
        expect((await deleted).status).toBe(deletedStatus);
      } finally {
        hold.release();
      }

      const left = await db
        .select({ id: trackAudios.id })
        .from(trackAudios)
        .where(eq(trackAudios.trackId, trackId));
      expect(left).toEqual([]);
    },
    RACE_TIMEOUT
  );

  it(
    "leaves the primary where it was when the version being made primary is deleted first",
    async () => {
      requireProject();
      const { trackId, doomed, keptVersionId } =
        await trackWithKeptAndDoomedVersions("Racing Primary Of Doomed");
      const [doomedVersion] = await db
        .select({ id: trackAudios.id })
        .from(trackAudios)
        .where(eq(trackAudios.assetId, doomed.id));

      const setPrimary = await raceDeleteAgainst(doomed.id, () =>
        request("owner", `/track-audios/${doomedVersion!.id}/primary`, {
          method: "PATCH",
        })
      );

      expect(setPrimary.status).toBe(404);
      const left = await db
        .select({ id: trackAudios.id, isPrimary: trackAudios.isPrimary })
        .from(trackAudios)
        .where(eq(trackAudios.trackId, trackId));
      expect(left).toEqual([{ id: keptVersionId, isPrimary: true }]);
    },
    RACE_TIMEOUT
  );

  /**
   * A throwaway project holding one track with two versions, the kept one
   * first in both row and version order (see
   * {@link trackWithKeptAndDoomedVersions}), each named by an asset of the
   * project. Its owner is the only actor that can reach it.
   */
  const projectWithTwoVersions = async (name: string) => {
    const project = await suite.throwawayProject(name);
    const upload = (file: string) =>
      suite.uploadTypedAsset(
        file,
        "audio/wav",
        fakeWav,
        project.owner.cookie,
        project.id
      );
    const kept = await upload(`${name}.wav`);
    const doomed = await upload(`${name}.mp3`);

    const created = await suite.requestAs(project.owner, "/tracks", {
      method: "POST",
      body: JSON.stringify({
        title: `${name} Track`,
        artists: ["A"],
        projectId: project.id,
      }),
    });
    expect(created.status).toBe(201);
    const trackId = ((await created.json()) as { id: number }).id;

    const [keptVersion, doomedVersion] = await addVersions(
      trackId,
      [kept.id, doomed.id],
      kept.id
    );
    return {
      project,
      trackId,
      keptVersionId: keptVersion!.id,
      doomedVersionId: doomedVersion!.id,
    };
  };

  const projectGone = async (id: number) =>
    (
      await db.execute<{ id: number }>(
        sql`select id from projects where id = ${id}`
      )
    ).rows.length === 0;

  it(
    "holds a comment on a version of a deleted project's track until the delete commits, then answers 404",
    async () => {
      requireProject();
      const { project, doomedVersionId } = await projectWithTwoVersions(
        "Comment After Project Delete"
      );

      // Held once the delete has locked and removed the tracks' versions.
      const hold = holdAfter((text) => text.includes('delete from "tracks"'));
      try {
        const deleted = suite.requestAs(
          project.owner,
          `/projects/${project.id}`,
          { method: "DELETE" }
        );
        await hold.held;

        const comment = suite.requestAs(project.owner, "/comments", {
          method: "POST",
          body: JSON.stringify({
            targetType: "track_audio",
            targetId: doomedVersionId,
            content: "posted while the project was being deleted",
          }),
        });
        await untilWaiting("for share");
        hold.release();

        expect((await deleted).status).toBe(204);
        expect((await comment).status).toBe(404);
      } finally {
        hold.release();
      }

      expect(await projectGone(project.id)).toBe(true);
    },
    RACE_TIMEOUT
  );

  it(
    "queues a delete of a project behind a comment on a version of one of its tracks, then removes the comment with it",
    async () => {
      requireProject();
      const { project, doomedVersionId } = await projectWithTwoVersions(
        "Racing Project Comment"
      );

      const hold = holdAfter((text) => text.includes("for share"));
      try {
        const comment = suite.requestAs(project.owner, "/comments", {
          method: "POST",
          body: JSON.stringify({
            targetType: "track_audio",
            targetId: doomedVersionId,
            content: "posted while the project was being deleted",
          }),
        });
        await hold.held;

        const deleted = suite.requestAs(
          project.owner,
          `/projects/${project.id}`,
          { method: "DELETE" }
        );
        await waitFor(
          async () =>
            expect(
              (await waitingOnLock('from "track_audios"')) ||
                (await waitingOnLock('delete from "tracks"')) ||
                (await waitingOnLock("for update"))
            ).toBe(true),
          { timeout: 3000 }
        );
        hold.release();

        expect((await comment).status).toBe(201);
        expect((await deleted).status).toBe(204);
      } finally {
        hold.release();
      }

      expect(await projectGone(project.id)).toBe(true);
      const left = await db
        .select({ id: comments.id })
        .from(comments)
        .where(eq(comments.targetId, doomedVersionId));
      expect(left).toEqual([]);
    },
    RACE_TIMEOUT
  );

  it("a viewer is refused", async () => {
    requireProject();
    const folder = bounceFolder();
    await scanned(folder, "Gated.wav");
    const mp3 = await scanned(folder, "Gated.mp3");

    await expectAccess(
      "POST",
      `/assets/project/${suite.projectId}/duplicates/remove`,
      { viewer: 403, editor: 200 },
      { ids: [mp3.id] }
    );

    // The editor's allowed call is the one that removed it.
    expect(await assetExists(mp3.id)).toBe(false);
  });

  /**
   * The mount proves the caller may edit the project in the path; only the
   * audit of that project decides which ids may go, and no audit of it can
   * list another project's file.
   */
  it("does not delete another project's duplicates", async () => {
    requireProject();
    const other = await suite.throwawayProject("Foreign Dupes");
    const foreign = [];
    for (const name of ["Foreign.wav", "Foreign.mp3"]) {
      const asset = await uploadTypedAsset(
        name,
        "audio/wav",
        fakeWav,
        other.owner.cookie,
        other.id
      );
      await db
        .update(assets)
        .set({
          localFilepath: `/Users/producer/Foreign/${name}`,
          localFileMachineName: "Studio Mac",
          localFileUpdatedAt: new Date(bounceAt),
        })
        .where(eq(assets.id, asset.id));
      foreign.push(asset);
    }
    const [, foreignMp3] = foreign;

    // Removable in its own project, so only the project scope protects it.
    const theirs = await findDuplicateAudio(other.id);
    expect(groupWith(theirs, foreignMp3!.id)?.remove.map((f) => f.id)).toEqual([
      foreignMp3!.id,
    ]);

    const res = await removeDuplicates([foreignMp3!.id]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: 0 });
    expect(await assetExists(foreignMp3!.id)).toBe(true);
    expect(existsSync(onDiskPath(foreignMp3!.assetPath))).toBe(true);
  });

  it("refuses an empty id list and one past the cap", async () => {
    requireProject();

    expect((await removeDuplicates([])).status).toBe(400);
    expect(
      (await removeDuplicates(Array.from({ length: 501 }, (_, i) => i + 1)))
        .status
    ).toBe(400);
  });
});
