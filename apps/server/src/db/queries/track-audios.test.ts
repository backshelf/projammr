import { eq, sql } from "drizzle-orm";
import { access, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import type { Spectrum } from "@workspace/dsp/spectrum";
import { ANALYSIS_VERSION } from "@workspace/dsp/version";
import { gate } from "@workspace/test/gate";
import { waitFor } from "@workspace/test/wait-for";
import { subscribeProject } from "../../lib/job-events.js";
import { mediaQueue } from "../../lib/jobs.js";
import { storedFilePath } from "../../lib/storage.js";
import {
  settleJobs,
  settleProjectJobs,
  settleSubjectJobs,
  writeTone,
  writeToneWithSection,
} from "../../test/media.js";
import { db } from "../index.js";
import { assets } from "../schema/assets.js";
import { collections, collectionTracks } from "../schema/collections.js";
import { projects } from "../schema/projects.js";
import { ROOT_NOTES, sessions } from "../schema/sessions.js";
import { trackAudioFeatures } from "../schema/track-audio-analysis.js";
import {
  trackAudioLazyColumns,
  trackAudios,
  tracks,
} from "../schema/tracks.js";
import {
  type ProjectPolicyPatch,
  withProjectPolicyForTest,
} from "./project-policy.js";
import { seedScale } from "../../test/priority.js";
import { withDefaultLevel } from "./priority-levels.js";
import { addUsage, projectScope, usageFor } from "./storage-usage.js";

/**
 * The read paths must never spawn, so the real ffmpeg spawn is wrapped in a
 * spy that still calls through to it. Everything else in the module —
 * `isAudioName` above all — stays real. It is copied out before the mock
 * replaces the module's live bindings.
 */
const actualMedia = { ...(await import("../../lib/media.js")) };
const media = { decodeInto: mock(actualMedia.decodeInto) };

mock.module("../../lib/media.js", () => ({ ...actualMedia, ...media }));

const { cancelJob, getJob } = await import("./jobs.js");

const {
  enqueueAudioAnalysis,
  getCollectionAudioSummary,
  getCollectionRuntimeMs,
  getRecentTrackAudios,
  getTrackAudioDiff,
  getTrackAudioMeasure,
  linkTrackAudios,
  settleKeyMode,
  TRACK_ANALYSIS_LOCK_CLASS,
  unlinkTrackAudio,
} = await import("./track-audios.js");

const { deleteAsset, deleteAssetsInProject, removeDuplicateAudio } =
  await import("./assets.js");

/** A key prefix under the static root: an asset row records a key, not a path. */
let dir: string;
let projectId: number;
let analysedTrackId: number;
let analysedAudioId: number;
let collectionId: number;

/** A real tone of `seconds`, so analysis has something to read. */
async function makeAudioAsset(
  name: string,
  seconds: number,
  hz = 440,
  { gainDb = 0, format = "wav" as "wav" | "flac" | "mp3" } = {}
) {
  const assetPath = join(dir, name);
  await writeTone(storedFilePath(assetPath), { seconds, hz, gainDb, format });

  const [asset] = await db
    .insert(assets)
    .values({
      name,
      type: format === "mp3" ? "audio/mpeg" : "audio/wav",
      size: 0,
      assetPath,
      projectId,
    })
    .returning({ id: assets.id });
  return asset!.id;
}

/** A tone whose second half changes pitch, so a duplicate check meets a fixture that differs by one section. */
async function makeSectionedAudioAsset(name: string, seconds: number) {
  const assetPath = join(dir, name);
  await writeToneWithSection(storedFilePath(assetPath), { seconds });

  const [asset] = await db
    .insert(assets)
    .values({
      name,
      type: "audio/wav",
      size: 0,
      assetPath,
      projectId,
    })
    .returning({ id: assets.id });
  return asset!.id;
}

/**
 * Whether the diff for the pair is stored: `getTrackAudioDiff` computes any
 * missing pair of current versions on read, so it cannot tell.
 */
async function diffStored(fromId: number, toId: number) {
  const stored = await db.query.trackAudioDiffs.findFirst({
    where: { fromId, toId },
  });
  return stored !== undefined;
}

async function makeTrack(title: string) {
  const [track] = await db
    .insert(tracks)
    .values(await withDefaultLevel({ title, artists: [], projectId }))
    .returning({ id: tracks.id });
  return track!.id;
}

beforeAll(async () => {
  dir = `assets/track-audios-test-${crypto.randomUUID()}`;
  await mkdir(storedFilePath(dir), { recursive: true });

  const [project] = await db
    .insert(projects)
    .values({ name: `Track Audio Test ${Date.now()}` })
    .returning({ id: projects.id });
  projectId = project!.id;
  await seedScale(projectId);

  analysedTrackId = await makeTrack("Analysed");
  const assetId = await makeAudioAsset("analysed.wav", 1);
  const linked = await linkTrackAudios(analysedTrackId, [assetId]);
  analysedAudioId = linked.audios[0]!.id;

  const [collection] = await db
    .insert(collections)
    .values(await withDefaultLevel({ title: "Runtime", projectId }))
    .returning({ id: collections.id });
  collectionId = collection!.id;
  await db
    .insert(collectionTracks)
    .values({ collectionId, trackId: analysedTrackId, trackNumber: 1 });
});

afterAll(async () => {
  // Spectrogram PNGs land under `static/analysis/`, outside `dir`, keyed by
  // their own random name rather than the test's asset paths.
  const spectrograms = await db
    .select({ spectrogramKey: trackAudios.spectrogramKey })
    .from(trackAudios)
    .innerJoin(tracks, eq(tracks.id, trackAudios.trackId))
    .where(eq(tracks.projectId, projectId));

  await db.delete(projects).where(eq(projects.id, projectId));
  await rm(storedFilePath(dir), { recursive: true, force: true });
  await Promise.all(
    spectrograms.flatMap(({ spectrogramKey }) =>
      spectrogramKey
        ? [rm(storedFilePath(spectrogramKey), { force: true })]
        : []
    )
  );
});

beforeEach(async () => {
  await settleProjectJobs(projectId);
  media.decodeInto.mockClear();
});

describe("background audio analysis", () => {
  it("fills in every column and the current analysis version after linking, not during", async () => {
    const trackId = await makeTrack("Freshly Linked");
    const assetId = await makeAudioAsset("fresh.wav", 0.5);

    // The link responds with what is stored; analysis is still queued.
    const linked = await linkTrackAudios(trackId, [assetId]);
    expect(linked.audios).toHaveLength(1);
    expect(linked.audios[0]!.durationMs).toBeNull();
    expect(linked.analysisJobIds).toHaveLength(1);
    expect(mediaQueue.size).toBeGreaterThan(0);

    await settleJobs(linked.analysisJobIds);

    const [row] = await db
      .select({
        durationMs: trackAudios.durationMs,
        audioPeaks: trackAudios.audioPeaks,
        lufs: trackAudios.lufs,
        analysisVersion: trackAudios.analysisVersion,
      })
      .from(trackAudios)
      .where(eq(trackAudios.id, linked.audios[0]!.id));

    expect(row!.durationMs).toBeCloseTo(500, -2);
    expect(row!.audioPeaks?.length).toBeGreaterThan(0);
    expect(row!.lufs).toBeTypeOf("number");
    expect(row!.analysisVersion).toBe(ANALYSIS_VERSION);
  });

  it("leaves a row whose file cannot be read alone", async () => {
    const trackId = await makeTrack("Unreadable");
    const [asset] = await db
      .insert(assets)
      .values({
        name: "missing.wav",
        type: "audio/wav",
        size: 0,
        assetPath: join(dir, "does-not-exist.wav"),
        projectId,
      })
      .returning({ id: assets.id });

    const linked = await linkTrackAudios(trackId, [asset!.id]);
    await settleJobs(linked.analysisJobIds);

    const [row] = await db
      .select({
        durationMs: trackAudios.durationMs,
        audioPeaks: trackAudios.audioPeaks,
        analysisVersion: trackAudios.analysisVersion,
      })
      .from(trackAudios)
      .where(eq(trackAudios.id, linked.audios[0]!.id));

    expect(row!.durationMs).toBeNull();
    expect(row!.audioPeaks).toBeNull();
    expect(row!.analysisVersion).toBeNull();
  });

  it("queues no analysis on link where the project does not analyse automatically, and still analyses on request", async () => {
    const trackId = await makeTrack("Analysed On Request");
    const assetId = await makeAudioAsset("on-request.wav", 0.5);

    const linked = await withProjectPolicyForTest(
      projectId,
      { audio: { autoAnalyse: false } },
      () => linkTrackAudios(trackId, [assetId])
    );
    expect(linked.analysisJobIds).toEqual([]);
    const audioId = linked.audios[0]!.id;

    const queued = await enqueueAudioAnalysis([audioId]);
    expect(queued).toHaveLength(1);
    await settleJobs(queued.map((job) => job.id));

    const [row] = await db
      .select({ analysisVersion: trackAudios.analysisVersion })
      .from(trackAudios)
      .where(eq(trackAudios.id, audioId));
    expect(row!.analysisVersion).toBe(ANALYSIS_VERSION);
  });

  it("coalesces repeated enqueues of the same audio", async () => {
    const trackId = await makeTrack("Coalesced");
    const assetId = await makeAudioAsset("coalesced.wav", 0.5);
    const [row] = await db
      .insert(trackAudios)
      .values({ trackId, assetId, version: 1 })
      .returning({ id: trackAudios.id });

    for (let i = 0; i < 5; i++) await enqueueAudioAnalysis([row!.id]);
    await settleSubjectJobs("audio_analysis", [row!.id]);

    expect(media.decodeInto).toHaveBeenCalledTimes(1);
  });
});

describe("offline analysis columns", () => {
  it("stores the spectrogram file, quantised features and a detected key for a real tone", async () => {
    const trackId = await makeTrack("Offline Columns");
    const assetId = await makeAudioAsset("offline-columns.wav", 2);

    const linked = await linkTrackAudios(trackId, [assetId]);
    await settleJobs(linked.analysisJobIds);

    const audioId = linked.audios[0]!.id;
    const [row] = await db
      .select({
        spectrogramKey: trackAudios.spectrogramKey,
        musicalKey: trackAudios.musicalKey,
        keyConfidence: trackAudios.keyConfidence,
        sections: trackAudios.sections,
        correlationCurve: trackAudios.correlationCurve,
        silence: trackAudios.silence,
      })
      .from(trackAudios)
      .where(eq(trackAudios.id, audioId));

    expect(row!.spectrogramKey).not.toBeNull();
    // Throws if the PNG the funnel wrote is missing.
    await access(storedFilePath(row!.spectrogramKey!));

    expect(row!.musicalKey).toBeTypeOf("string");
    expect(row!.keyConfidence).toBeTypeOf("number");
    expect(Array.isArray(row!.sections)).toBe(true);
    expect(Array.isArray(row!.correlationCurve)).toBe(true);
    expect(row!.silence).not.toBeNull();

    const [features] = await db
      .select({ trackAudioId: trackAudioFeatures.trackAudioId })
      .from(trackAudioFeatures)
      .where(eq(trackAudioFeatures.trackAudioId, audioId));
    expect(features).toBeDefined();
  });

  it("settles the detected key against the main session only while the project corrects tempo and key", async () => {
    /** Links a fresh two-second tone to `trackId` and answers the key analysis stored. */
    const analysedKey = async (trackId: number, name: string) => {
      const linked = await linkTrackAudios(trackId, [
        await makeAudioAsset(`${name}.wav`, 2),
      ]);
      await settleJobs(linked.analysisJobIds);
      const [row] = await db
        .select({ musicalKey: trackAudios.musicalKey })
        .from(trackAudios)
        .where(eq(trackAudios.id, linked.audios[0]!.id));
      return row!.musicalKey;
    };

    // The tone's own key, with no session to settle it against.
    const detected = await analysedKey(
      await makeTrack("Key Undirected"),
      "key-undirected"
    );
    expect(detected).toBeTypeOf("string");

    // A session key the correction would adopt over the detected one.
    const hint = ROOT_NOTES.flatMap((rootNote) =>
      ["Major", "Minor"].map((scale) => ({ rootNote, scale }))
    ).find((session) => settleKeyMode(detected!, session) !== detected)!;

    const keyUnder = async (name: string, patch: ProjectPolicyPatch) => {
      const trackId = await makeTrack(name);
      await db.insert(sessions).values(
        await withDefaultLevel({
          name,
          daw: "ableton",
          projectId,
          trackId,
          main: true,
          rootNote: hint.rootNote,
          scale: hint.scale,
        })
      );
      return withProjectPolicyForTest(projectId, patch, () =>
        analysedKey(trackId, name)
      );
    };

    expect(await keyUnder("key-corrected", {})).toBe(
      settleKeyMode(detected!, hint)
    );
    expect(
      await keyUnder("key-uncorrected", {
        audio: { tempoKeyCorrection: false },
      })
    ).toBe(detected);
  });
});

describe("consecutive diffs", () => {
  it("diffs a newly analysed version against the previous one, and repairs a gap left by a deleted middle version", async () => {
    const trackId = await makeTrack("Diff Chain");

    const asset1 = await makeAudioAsset("diff-chain-1.wav", 2);
    const linked1 = await linkTrackAudios(trackId, [asset1]);
    await settleJobs(linked1.analysisJobIds);
    const v1 = linked1.audios[0]!.id;

    const asset2 = await makeAudioAsset("diff-chain-2.wav", 2);
    const linked2 = await linkTrackAudios(trackId, [asset2]);
    await settleJobs(linked2.analysisJobIds);
    const v2 = linked2.audios.find((a) => a.assetId === asset2)!.id;

    const diff12 = await getTrackAudioDiff(v1, v2);
    expect(diff12).toBeDefined();
    expect(diff12!.fromId).toBe(v1);
    expect(diff12!.toId).toBe(v2);

    const asset3 = await makeAudioAsset("diff-chain-3.wav", 2);
    const linked3 = await linkTrackAudios(trackId, [asset3]);
    await settleJobs(linked3.analysisJobIds);
    const v3 = linked3.audios.find((a) => a.assetId === asset3)!.id;

    expect(await getTrackAudioDiff(v2, v3)).toBeDefined();

    // Deleting the middle version cascades its own diffs away, but the
    // delete itself repairs the gap it just opened between its neighbours.
    expect(await diffStored(v1, v3)).toBe(false);
    await unlinkTrackAudio(v2);
    expect(await diffStored(v1, v3)).toBe(true);
  });

  it("waits for a concurrent holder of the same track's analysis lock before repairing a gap", async () => {
    const trackId = await makeTrack("Lock Serialisation");

    const asset1 = await makeAudioAsset("lock-chain-1.wav", 2);
    const linked1 = await linkTrackAudios(trackId, [asset1]);
    await settleJobs(linked1.analysisJobIds);
    const v1 = linked1.audios[0]!.id;

    const asset2 = await makeAudioAsset("lock-chain-2.wav", 2);
    const linked2 = await linkTrackAudios(trackId, [asset2]);
    await settleJobs(linked2.analysisJobIds);
    const v2 = linked2.audios.find((a) => a.assetId === asset2)!.id;

    const asset3 = await makeAudioAsset("lock-chain-3.wav", 2);
    const linked3 = await linkTrackAudios(trackId, [asset3]);
    await settleJobs(linked3.analysisJobIds);
    const v3 = linked3.audios.find((a) => a.assetId === asset3)!.id;

    // Holds the same lock `unlinkTrackAudio`'s repair takes for this track,
    // the way a concurrent analysis of another of its versions would.
    let holderReleased = false;
    const holder = db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${TRACK_ANALYSIS_LOCK_CLASS}, ${trackId})`
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      holderReleased = true;
    });

    // Give the holder a head start so it is certainly first in line.
    await new Promise((resolve) => setTimeout(resolve, 20));

    await unlinkTrackAudio(v2);
    // If the repair could skip the lock, it would have finished, and set the
    // gap's diff, well before the holder released it.
    expect(holderReleased).toBe(true);
    await holder;

    expect(await diffStored(v1, v3)).toBe(true);
  });
});

describe("asset deletes repair the versions they cascade away", () => {
  /** Links each asset in turn, analysed before the next, and returns the version ids in order. */
  async function linkChain(trackId: number, assetIds: number[]) {
    const ids: number[] = [];
    for (const assetId of assetIds) {
      const linked = await linkTrackAudios(trackId, [assetId]);
      await settleJobs(linked.analysisJobIds);
      ids.push(linked.audios.find((a) => a.assetId === assetId)!.id);
    }
    return ids;
  }

  const versionsOf = (trackId: number) =>
    db
      .select({ id: trackAudios.id, version: trackAudios.version })
      .from(trackAudios)
      .where(eq(trackAudios.trackId, trackId))
      .orderBy(trackAudios.version);

  it("renumbers the track and diffs the new neighbours when a middle version is removed as a duplicate", async () => {
    const trackId = await makeTrack("Duplicate Gap");
    const folder = `/Users/producer/Bounces/dup-gap-${crypto.randomUUID()}/`;
    const bounceAt = Date.UTC(2026, 0, 1, 12);

    // The wav and mp3 are one bounce, so the audit keeps the lossless wav
    // (v1) and lists the mp3 (v2) for removal; v3 is a later bounce.
    const wav = await makeAudioAsset("dup-gap.wav", 2);
    const mp3 = await makeAudioAsset("dup-gap.mp3", 2, 440, { format: "mp3" });
    const later = await makeAudioAsset("dup-gap-later.wav", 2, 660);
    for (const [id, name, minutesIn] of [
      [wav, "Gap.wav", 0],
      [mp3, "Gap.mp3", 1],
    ] as const) {
      await db
        .update(assets)
        .set({
          localFilepath: `${folder}${name}`,
          localFileMachineName: "Studio Mac",
          localFileUpdatedAt: new Date(bounceAt + minutesIn * 60_000),
        })
        .where(eq(assets.id, id));
    }
    const [v1, , v3] = await linkChain(trackId, [wav, mp3, later]);
    expect(await diffStored(v1!, v3!)).toBe(false);

    const removed = await removeDuplicateAudio(projectId, [mp3]);
    expect(removed.deleted).toBe(1);

    expect(await versionsOf(trackId)).toEqual([
      { id: v1!, version: 1 },
      { id: v3!, version: 2 },
    ]);
    expect(await diffStored(v1!, v3!)).toBe(true);
  });

  it("repairs the gap a single asset delete opens", async () => {
    const trackId = await makeTrack("Single Delete Gap");
    const assetIds = [
      await makeAudioAsset("single-gap-1.wav", 2),
      await makeAudioAsset("single-gap-2.wav", 2, 550),
      await makeAudioAsset("single-gap-3.wav", 2, 660),
    ];
    const [v1, , v3] = await linkChain(trackId, assetIds);

    await deleteAsset(assetIds[1]!);

    expect(await versionsOf(trackId)).toEqual([
      { id: v1!, version: 1 },
      { id: v3!, version: 2 },
    ]);
    expect(await diffStored(v1!, v3!)).toBe(true);
  });

  it("bridges several adjacent removed versions with one diff, on every track the delete reaches", async () => {
    const trackA = await makeTrack("Bulk Gap A");
    const trackB = await makeTrack("Bulk Gap B");
    // Shorter tones than the other chains: eight versions are analysed here.
    // The four are written side by side and each track links all of them in
    // one call, so the queue analyses both tracks together; the versions
    // then come back in the order the track numbered them.
    const assetIds = await Promise.all([
      makeAudioAsset("bulk-gap-1.wav", 1),
      makeAudioAsset("bulk-gap-2.wav", 1, 550),
      makeAudioAsset("bulk-gap-3.wav", 1, 660),
      makeAudioAsset("bulk-gap-4.wav", 1, 770),
    ]);
    const [linkedA, linkedB] = await Promise.all([
      linkTrackAudios(trackA, assetIds),
      linkTrackAudios(trackB, assetIds),
    ]);
    await settleJobs([...linkedA.analysisJobIds, ...linkedB.analysisJobIds]);
    const [a1, a2, a3, a4] = linkedA.audios;
    const [b1, , , b4] = linkedB.audios;

    const removed = await deleteAssetsInProject(projectId, [
      a2!.assetId,
      a3!.assetId,
    ]);
    expect(removed.deleted).toBe(2);

    for (const [trackId, first, last] of [
      [trackA, a1!.id, a4!.id],
      [trackB, b1!.id, b4!.id],
    ] as const) {
      expect(await versionsOf(trackId)).toEqual([
        { id: first, version: 1 },
        { id: last, version: 2 },
      ]);
      expect(await diffStored(first, last)).toBe(true);
    }
  });
});

describe("asset deletes return the spectrogram bytes they cascade away", () => {
  /**
   * An asset linked to a track with a stored spectrogram of `bytes`, counted
   * against the project the way the analysis worker counts it. Answers the
   * usage to expect once the asset is gone again.
   */
  async function linkTiledAsset(name: string, bytes: number) {
    const trackId = await makeTrack(name);
    const assetId = await makeAudioAsset(`${name}.wav`, 1);
    await db
      .insert(trackAudios)
      .values({ trackId, assetId, version: 1, spectrogramBytes: bytes });
    await addUsage(db, [projectScope(projectId)], bytes);
    return assetId;
  }

  it("subtracts them from the project when a single asset is deleted", async () => {
    const baseline = await usageFor(projectScope(projectId));
    const assetId = await linkTiledAsset("single-tile", 4096);
    expect(await usageFor(projectScope(projectId))).toBe(baseline + 4096);

    await deleteAsset(assetId);

    expect(await usageFor(projectScope(projectId))).toBe(baseline);
  });

  it("subtracts them from the project when assets are deleted in bulk", async () => {
    const baseline = await usageFor(projectScope(projectId));
    const first = await linkTiledAsset("bulk-tile-1", 4096);
    const second = await linkTiledAsset("bulk-tile-2", 1024);

    const removed = await deleteAssetsInProject(projectId, [first, second]);
    expect(removed.deleted).toBe(2);

    expect(await usageFor(projectScope(projectId))).toBe(baseline);
  });
});

describe("duplicate detection", () => {
  it("flags a later version with the same fingerprint as a duplicate of the earlier one", async () => {
    const trackId = await makeTrack("Duplicate Track");

    const original = await makeAudioAsset("duplicate-original.wav", 2, 440);
    const linkedOriginal = await linkTrackAudios(trackId, [original]);
    await settleJobs(linkedOriginal.analysisJobIds);
    const originalId = linkedOriginal.audios[0]!.id;

    const copy = await makeAudioAsset("duplicate-copy.wav", 2, 440);
    const linkedCopy = await linkTrackAudios(trackId, [copy]);
    await settleJobs(linkedCopy.analysisJobIds);
    const copyId = linkedCopy.audios.find((a) => a.assetId === copy)!.id;

    const [copyRow] = await db
      .select({ duplicateOfId: trackAudios.duplicateOfId })
      .from(trackAudios)
      .where(eq(trackAudios.id, copyId));
    expect(copyRow!.duplicateOfId).toBe(originalId);

    const [originalRow] = await db
      .select({ duplicateOfId: trackAudios.duplicateOfId })
      .from(trackAudios)
      .where(eq(trackAudios.id, originalId));
    expect(originalRow!.duplicateOfId).toBeNull();
  });

  it("does not flag versions with different content", async () => {
    const trackId = await makeTrack("Distinct Track");

    // 220 Hz and 300 Hz land in different pitch classes; two tones an octave
    // apart (e.g. 220 and 880) would share a chroma fingerprint by design
    // (chroma folds every octave together) and must not be used here.
    const low = await makeAudioAsset("distinct-low.wav", 2, 220);
    await settleJobs((await linkTrackAudios(trackId, [low])).analysisJobIds);

    const other = await makeAudioAsset("distinct-other.wav", 2, 300);
    const linkedOther = await linkTrackAudios(trackId, [other]);
    await settleJobs(linkedOther.analysisJobIds);
    const otherId = linkedOther.audios.find((a) => a.assetId === other)!.id;

    const [row] = await db
      .select({ duplicateOfId: trackAudios.duplicateOfId })
      .from(trackAudios)
      .where(eq(trackAudios.id, otherId));
    expect(row!.duplicateOfId).toBeNull();
  });

  it("flags the same bounce re-encoded to a different format at the same gain as a duplicate", async () => {
    const trackId = await makeTrack("Reencoded Track");

    const original = await makeAudioAsset("reencode-original.wav", 2, 440);
    const linkedOriginal = await linkTrackAudios(trackId, [original]);
    await settleJobs(linkedOriginal.analysisJobIds);
    const originalId = linkedOriginal.audios[0]!.id;

    const reencoded = await makeAudioAsset("reencode-copy.mp3", 2, 440, {
      format: "mp3",
    });
    const linkedCopy = await linkTrackAudios(trackId, [reencoded]);
    await settleJobs(linkedCopy.analysisJobIds);
    const copyId = linkedCopy.audios.find((a) => a.assetId === reencoded)!.id;

    const [row] = await db
      .select({ duplicateOfId: trackAudios.duplicateOfId })
      .from(trackAudios)
      .where(eq(trackAudios.id, copyId));
    expect(row!.duplicateOfId).toBe(originalId);
  });

  it("does not flag a louder remaster of the same arrangement as a duplicate", async () => {
    const trackId = await makeTrack("Remastered Track");

    const original = await makeAudioAsset("remaster-original.wav", 2, 440);
    await settleJobs(
      (await linkTrackAudios(trackId, [original])).analysisJobIds
    );

    const remaster = await makeAudioAsset("remaster-louder.wav", 2, 440, {
      gainDb: 3,
    });
    const linkedRemaster = await linkTrackAudios(trackId, [remaster]);
    await settleJobs(linkedRemaster.analysisJobIds);
    const remasterId = linkedRemaster.audios.find(
      (a) => a.assetId === remaster
    )!.id;

    const [row] = await db
      .select({ duplicateOfId: trackAudios.duplicateOfId })
      .from(trackAudios)
      .where(eq(trackAudios.id, remasterId));
    expect(row!.duplicateOfId).toBeNull();
  });

  it("does not flag a version that differs from another by one section", async () => {
    const trackId = await makeTrack("Sectioned Track");

    const whole = await makeAudioAsset("section-whole.wav", 2, 440);
    await settleJobs((await linkTrackAudios(trackId, [whole])).analysisJobIds);

    const sectioned = await makeSectionedAudioAsset("section-changed.wav", 2);
    const linkedSectioned = await linkTrackAudios(trackId, [sectioned]);
    await settleJobs(linkedSectioned.analysisJobIds);
    const sectionedId = linkedSectioned.audios.find(
      (a) => a.assetId === sectioned
    )!.id;

    const [row] = await db
      .select({ duplicateOfId: trackAudios.duplicateOfId })
      .from(trackAudios)
      .where(eq(trackAudios.id, sectionedId));
    expect(row!.duplicateOfId).toBeNull();
  });
});

describe("analysis version", () => {
  it("does not re-decode a row already at the current analysis version", async () => {
    await settleJobs(
      (await enqueueAudioAnalysis([analysedAudioId])).map((job) => job.id)
    );

    expect(await decodesOf(analysedAudioId)).toBe(0);
  });

  it("re-decodes and overwrites a row whose analysis version is behind ANALYSIS_VERSION", async () => {
    const { id } = await insertOutstandingAudio("Stale Version", {
      analysisVersion: 0,
    });

    await settleJobs((await enqueueAudioAnalysis([id])).map((job) => job.id));

    expect(await decodesOf(id)).toBe(1);

    const [after] = await db
      .select({
        durationMs: trackAudios.durationMs,
        audioPeaks: trackAudios.audioPeaks,
        analysisVersion: trackAudios.analysisVersion,
      })
      .from(trackAudios)
      .where(eq(trackAudios.id, id));

    expect(after!.analysisVersion).toBe(ANALYSIS_VERSION);
    expect(after!.durationMs).toBeCloseTo(500, -2);
    // The stale placeholder peaks are replaced, not merged with, the real decode.
    expect(after!.audioPeaks).not.toEqual([0]);
  });
});

describe("job step progress", () => {
  it("climbs decode, analyse and store in order with a rising percent", async () => {
    const trackId = await makeTrack("Funnel Steps");
    const assetId = await makeAudioAsset("funnel-steps.wav", 1);

    const linked = await linkTrackAudios(trackId, [assetId]);
    const audioId = linked.audios[0]!.id;

    const events: {
      stepIndex: number | null;
      percent: number;
      status: string;
    }[] = [];
    const unsubscribe = subscribeProject(projectId, (job) => {
      if (job.subjectId === audioId) {
        events.push({
          stepIndex: job.stepIndex,
          percent: job.percent,
          status: job.status,
        });
      }
    });
    try {
      await settleJobs(linked.analysisJobIds);
    } finally {
      unsubscribe();
    }

    const running = events.filter((event) => event.status === "running");
    // Every step key the ladder declares, visited once each and in order —
    // not just any progress, the funnel's own decode → analyse → store.
    expect([...new Set(running.map((event) => event.stepIndex))]).toEqual([
      0, 1, 2,
    ]);
    for (let i = 1; i < running.length; i++) {
      expect(running[i]!.stepIndex).toBeGreaterThanOrEqual(
        running[i - 1]!.stepIndex!
      );
      expect(running[i]!.percent).toBeGreaterThanOrEqual(
        running[i - 1]!.percent
      );
    }
    expect(events.at(-1)).toMatchObject({ status: "done", percent: 100 });
  });

  it("ends cancelled when a cancel lands during decode", async () => {
    const trackId = await makeTrack("Cancel During Decode");
    const assetId = await makeAudioAsset("cancel-during-decode.wav", 1);

    const decoding = gate();
    media.decodeInto.mockImplementation(
      (_path, _session, options) =>
        new Promise((_resolve, reject) => {
          decoding.open();
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("decode aborted", "AbortError"));
          });
        })
    );

    try {
      const linked = await linkTrackAudios(trackId, [assetId]);
      const jobId = linked.analysisJobIds[0]!;

      await decoding.opened;
      await waitFor(async () =>
        expect((await getJob(jobId)).stepIndex).toBe(0)
      );

      await cancelJob(jobId);
      await settleJobs([jobId]);

      const finished = await getJob(jobId);
      expect(finished.status).toBe("cancelled");
      expect(finished.stepIndex).toBe(0);
      expect(finished.finishedAt).not.toBeNull();
    } finally {
      // Later tests in this file need decode to actually run, not hang on
      // an abort that never comes.
      media.decodeInto.mockImplementation(actualMedia.decodeInto);
    }
  });
});

describe("getTrackAudioMeasure", () => {
  it("returns the stored peaks without spawning", async () => {
    const peaks = (await getTrackAudioMeasure(analysedAudioId, "peaks")) as
      number[] | undefined;
    expect(peaks?.length).toBeGreaterThan(0);
    expect(media.decodeInto).not.toHaveBeenCalled();
  });

  it("queues the analysis and returns nothing while peaks are missing", async () => {
    const trackId = await makeTrack("Peaks Pending");
    const assetId = await makeAudioAsset("pending.wav", 0.5);
    const [row] = await db
      .insert(trackAudios)
      .values({ trackId, assetId, version: 1 })
      .returning({ id: trackAudios.id });

    // Nothing yet: the read answers without waiting on a decode, which the
    // queue may already have started by the time this line runs.
    expect(await getTrackAudioMeasure(row!.id, "peaks")).toBeUndefined();

    await settleSubjectJobs("audio_analysis", [row!.id]);
    const peaks = (await getTrackAudioMeasure(row!.id, "peaks")) as
      number[] | undefined;
    expect(peaks?.length).toBeGreaterThan(0);
  });

  it("returns nothing for a track audio that does not exist", async () => {
    expect(await getTrackAudioMeasure(99_999_999, "peaks")).toBeUndefined();
  });

  it("re-queues and refreshes the peaks of a row whose analysis has gone stale", async () => {
    const { id, peaks } = await insertOutstandingAudio("Peaks Stale");

    expect(await getTrackAudioMeasure(id, "peaks")).toEqual(peaks);
    expect(mediaQueue.size).toBeGreaterThan(0);

    await settleSubjectJobs("audio_analysis", [id]);
    expect(await getTrackAudioMeasure(id, "peaks")).not.toEqual(peaks);
  });

  it("queues the analysis and returns nothing while the spectrum is missing", async () => {
    const trackId = await makeTrack("Spectrum Pending");
    const assetId = await makeAudioAsset("spectrum-pending.wav", 0.5);
    const [row] = await db
      .insert(trackAudios)
      .values({ trackId, assetId, version: 1 })
      .returning({ id: trackAudios.id });

    expect(await getTrackAudioMeasure(row!.id, "spectrum")).toBeUndefined();
    expect(media.decodeInto).not.toHaveBeenCalled();
    expect(mediaQueue.size).toBeGreaterThan(0);

    await settleSubjectJobs("audio_analysis", [row!.id]);
    const spectrum = (await getTrackAudioMeasure(row!.id, "spectrum")) as
      Spectrum | undefined;
    expect(spectrum?.hz).toHaveLength(96);
  });

  it("returns the stored spectrum without spawning", async () => {
    const trackId = await makeTrack("Spectrum Stored");
    const assetId = await makeAudioAsset(`${crypto.randomUUID()}.wav`, 0.5);
    const ltas: Spectrum = { hz: [20, 200, 2000], db: [-40, -20, -30] };
    const [row] = await db
      .insert(trackAudios)
      .values({
        trackId,
        assetId,
        version: 1,
        durationMs: 500,
        audioPeaks: [0.1, 0.2],
        lufs: -14,
        ltas,
        analysisVersion: ANALYSIS_VERSION,
      })
      .returning({ id: trackAudios.id });

    expect(await getTrackAudioMeasure(row!.id, "spectrum")).toEqual(ltas);
    expect(media.decodeInto).not.toHaveBeenCalled();
  });
});

describe("getCollectionAudioSummary", () => {
  it("queues analysis for a primary audio that has none yet", async () => {
    const [collection] = await db
      .insert(collections)
      .values(await withDefaultLevel({ title: "Loudness Heal", projectId }))
      .returning({ id: collections.id });
    const trackId = await makeTrack("Rail Unanalysed");
    const assetId = await makeAudioAsset(`${crypto.randomUUID()}.wav`, 0.5);
    const [row] = await db
      .insert(trackAudios)
      .values({ trackId, assetId, version: 1, isPrimary: true })
      .returning({ id: trackAudios.id });
    const id = row!.id;
    await db
      .insert(collectionTracks)
      .values({ collectionId: collection!.id, trackId, trackNumber: 1 });

    expect(
      (await getCollectionAudioSummary(collection!.id)).loudness
    ).toBeNull();
    expect(mediaQueue.size).toBeGreaterThan(0);

    await settleSubjectJobs("audio_analysis", [id]);
    expect(await loudnessOf(id)).toBeTypeOf("number");
    const summary = await getCollectionAudioSummary(collection!.id);
    expect(summary.loudness?.measured).toBe(1);
  });
});

/**
 * A track audio whose analysis is outstanding: placeholder measurements that
 * a real decode would never produce, so a test can tell whether they were
 * left alone or replaced. `analysisVersion` defaults to null (never
 * analysed); pass one below `ANALYSIS_VERSION` to simulate a stale row
 * instead.
 */
/**
 * How many times `decodeInto` read this track audio's file. Counting every call
 * would also count a retry another test left scheduled outside the queue,
 * which can still be decoding its own audio.
 */
async function decodesOf(trackAudioId: number): Promise<number> {
  const [row] = await db
    .select({ assetPath: assets.assetPath })
    .from(trackAudios)
    .innerJoin(assets, eq(assets.id, trackAudios.assetId))
    .where(eq(trackAudios.id, trackAudioId));
  const file = storedFilePath(row!.assetPath);
  return media.decodeInto.mock.calls.filter(([path]) => path === file).length;
}

async function insertOutstandingAudio(
  title: string,
  {
    isPrimary = false,
    analysisVersion = null,
  }: { isPrimary?: boolean; analysisVersion?: number | null } = {}
) {
  const trackId = await makeTrack(title);
  const assetId = await makeAudioAsset(`${crypto.randomUUID()}.wav`, 0.5);
  const peaks = [0];
  const [row] = await db
    .insert(trackAudios)
    .values({
      trackId,
      assetId,
      version: 1,
      isPrimary,
      durationMs: 1,
      audioPeaks: peaks,
      lufs: 0,
      ltas: { hz: [1], db: [1] },
      analysisVersion,
    })
    .returning({ id: trackAudios.id });
  return { id: row!.id, trackId, peaks };
}

async function loudnessOf(trackAudioId: number) {
  const [row] = await db
    .select({ lufs: trackAudios.lufs })
    .from(trackAudios)
    .where(eq(trackAudios.id, trackAudioId));
  return row?.lufs;
}

describe("getCollectionRuntimeMs", () => {
  it("sums the analysed durations without spawning", async () => {
    const runtime = await getCollectionRuntimeMs(collectionId);

    expect(runtime.runtimeMs).toBeCloseTo(1000, -2);
    expect(runtime.complete).toBe(true);
    expect(media.decodeInto).not.toHaveBeenCalled();
  });

  it("reports an incomplete runtime and queues the missing analysis", async () => {
    const trackId = await makeTrack("Unanalysed Member");
    const assetId = await makeAudioAsset("member.wav", 0.5);
    const [row] = await db
      .insert(trackAudios)
      .values({ trackId, assetId, version: 1, isPrimary: true })
      .returning({ id: trackAudios.id });
    await db
      .insert(collectionTracks)
      .values({ collectionId, trackId, trackNumber: 2 });

    const runtime = await getCollectionRuntimeMs(collectionId);
    expect(runtime.runtimeMs).toBeCloseTo(1000, -2);
    expect(runtime.complete).toBe(false);
    // The request queued the missing analysis rather than waiting on it: the
    // queue still has work outstanding, whether or not the job it started has
    // reached its own first decode by now.
    expect(mediaQueue.size).toBeGreaterThan(0);

    await settleSubjectJobs("audio_analysis", [row!.id]);
    const settled = await getCollectionRuntimeMs(collectionId);
    expect(settled.runtimeMs).toBeCloseTo(1500, -2);
    expect(settled.complete).toBe(true);
  });

  it("returns a stale primary audio's stored duration while queuing a fresh decode", async () => {
    const { id, trackId } = await insertOutstandingAudio("Stale Duration", {
      isPrimary: true,
      analysisVersion: 0,
    });
    const [collection] = await db
      .insert(collections)
      .values(
        await withDefaultLevel({ title: "Stale Duration Runtime", projectId })
      )
      .returning({ id: collections.id });
    await db
      .insert(collectionTracks)
      .values({ collectionId: collection!.id, trackId, trackNumber: 1 });

    const runtime = await getCollectionRuntimeMs(collection!.id);
    // The stale placeholder duration is returned at once — unlike a row with
    // no duration yet, which makes the total incomplete — while a fresh
    // decode is still queued behind it.
    expect(runtime.runtimeMs).toBe(1);
    expect(runtime.complete).toBe(true);
    // Queued behind, not waited on — the same margin the previous test reads.
    expect(mediaQueue.size).toBeGreaterThan(0);

    await settleSubjectJobs("audio_analysis", [id]);
    const refreshed = await getCollectionRuntimeMs(collection!.id);
    expect(refreshed.runtimeMs).toBeCloseTo(500, -2);
  });
});

describe("getRecentTrackAudios", () => {
  const SINCE = new Date("2026-03-05T00:00:00.000Z");
  let scopeProjectId: number;
  let otherProjectId: number;

  async function insertProject(name: string) {
    const [project] = await db
      .insert(projects)
      .values({ name: `${name} ${Date.now()}` })
      .returning({ id: projects.id });
    await seedScale(project!.id);
    return project!.id;
  }

  async function insertTrack(
    inProject: number,
    title: string,
    archived = false
  ) {
    const [track] = await db
      .insert(tracks)
      .values(
        await withDefaultLevel({
          title,
          artists: [],
          projectId: inProject,
          archivedAt: archived ? new Date() : null,
        })
      )
      .returning({ id: tracks.id });
    return track!.id;
  }

  /** A linked audio row written straight, with the link time under test. */
  async function insertLinked(
    inProject: number,
    trackId: number,
    createdAt: Date,
    version = 1
  ) {
    const [asset] = await db
      .insert(assets)
      .values({
        name: `recent-${trackId}-${version}.wav`,
        type: "audio/wav",
        size: 0,
        assetPath: `${dir}/recent-${trackId}-${version}-${crypto.randomUUID()}.wav`,
        projectId: inProject,
      })
      .returning({ id: assets.id });
    const [audio] = await db
      .insert(trackAudios)
      .values({ trackId, assetId: asset!.id, version, createdAt })
      .returning({ id: trackAudios.id });
    return audio!.id;
  }

  beforeAll(async () => {
    scopeProjectId = await insertProject("Recent Audios");
    otherProjectId = await insertProject("Recent Audios Other");
  });

  afterAll(async () => {
    await db.delete(projects).where(eq(projects.id, scopeProjectId));
    await db.delete(projects).where(eq(projects.id, otherProjectId));
  });

  it("returns only the requested project's audios", async () => {
    const mine = await insertTrack(scopeProjectId, "Mine");
    const theirs = await insertTrack(otherProjectId, "Theirs");
    const audioId = await insertLinked(scopeProjectId, mine, new Date());
    await insertLinked(otherProjectId, theirs, new Date());

    const { audios: rows } = await getRecentTrackAudios(
      scopeProjectId,
      SINCE,
      50
    );
    expect(rows.map((row) => row.id)).toContain(audioId);
    expect(rows.every((row) => row.owner?.projectId === scopeProjectId)).toBe(
      true
    );
  });

  it("leaves out an archived track's audios", async () => {
    const archived = await insertTrack(scopeProjectId, "Archived", true);
    const audioId = await insertLinked(scopeProjectId, archived, new Date());

    const { audios: rows } = await getRecentTrackAudios(
      scopeProjectId,
      SINCE,
      50
    );
    expect(rows.map((row) => row.id)).not.toContain(audioId);
  });

  it("leaves out audios linked before `since` and keeps one linked exactly at it", async () => {
    const trackId = await insertTrack(scopeProjectId, "Since");
    const before = await insertLinked(
      scopeProjectId,
      trackId,
      new Date(SINCE.getTime() - 1),
      1
    );
    const at = await insertLinked(scopeProjectId, trackId, SINCE, 2);

    const ids = (
      await getRecentTrackAudios(scopeProjectId, SINCE, 50)
    ).audios.map((row) => row.id);
    expect(ids).not.toContain(before);
    expect(ids).toContain(at);
  });

  it("answers an empty list and a total of 0 for a `since` in the future", async () => {
    expect(
      await getRecentTrackAudios(scopeProjectId, new Date("2999-01-01"), 50)
    ).toEqual({ audios: [], total: 0 });
  });

  it("returns newest linked first, breaking a tie by newest id", async () => {
    const project = await insertProject("Recent Audios Order");
    try {
      const trackId = await insertTrack(project, "Order");
      const older = await insertLinked(
        project,
        trackId,
        new Date("2026-03-06T00:00:00Z"),
        1
      );
      const tieFirst = await insertLinked(
        project,
        trackId,
        new Date("2026-03-07T00:00:00Z"),
        2
      );
      const tieSecond = await insertLinked(
        project,
        trackId,
        new Date("2026-03-07T00:00:00Z"),
        3
      );

      const { audios: rows } = await getRecentTrackAudios(project, SINCE, 50);
      expect(rows.map((row) => row.id)).toEqual([tieSecond, tieFirst, older]);
    } finally {
      await db.delete(projects).where(eq(projects.id, project));
    }
  });

  it("caps the list at the limit, keeping the newest", async () => {
    const project = await insertProject("Recent Audios Cap");
    try {
      const trackId = await insertTrack(project, "Cap");
      await insertLinked(project, trackId, new Date("2026-03-06T00:00:00Z"), 1);
      const newest = await insertLinked(
        project,
        trackId,
        new Date("2026-03-08T00:00:00Z"),
        2
      );

      const { audios: rows, total } = await getRecentTrackAudios(
        project,
        SINCE,
        1
      );
      expect(rows.map((row) => row.id)).toEqual([newest]);
      expect(total).toBe(2);
      expect(rows[0]).not.toHaveProperty("total");
    } finally {
      await db.delete(projects).where(eq(projects.id, project));
    }
  });

  it("attaches the asset and owner and carries no lazy column", async () => {
    const project = await insertProject("Recent Audios Shape");
    try {
      const trackId = await insertTrack(project, "Shape");
      await insertLinked(project, trackId, new Date(), 1);

      const {
        audios: [row],
      } = await getRecentTrackAudios(project, SINCE, 50);
      expect(row!.asset.projectId).toBe(project);
      expect(row!.owner?.trackId).toBe(trackId);
      expect(row!.owner?.title).toBe("Shape");
      for (const column of Object.keys(trackAudioLazyColumns)) {
        expect(row).not.toHaveProperty(column);
      }
    } finally {
      await db.delete(projects).where(eq(projects.id, project));
    }
  });
});
