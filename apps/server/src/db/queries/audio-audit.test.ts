import { mkdir, rm, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ANALYSIS_VERSION } from "@workspace/dsp/version";
import { storedFilePath } from "../../lib/storage.js";
import { db } from "../index.js";
import { assets } from "../schema/assets.js";
import { sessionAttachments } from "../schema/attachments.js";
import { projects } from "../schema/projects.js";
import { sessions } from "../schema/sessions.js";
import { trackAudios, tracks, type NewTrackAudio } from "../schema/tracks.js";
import { DEFAULT_PROJECT_POLICY } from "./project-policy.js";
import { seedScale } from "../../test/priority.js";
import {
  audioFindings,
  auditProjectAudio,
  nameSimilarity,
  type AudioAudit,
} from "./track-audios.js";

let projectId: number;
let priorityId: number;
let dir: string;

let sharedTrackId: number;
let sharedOtherTrackId: number;
let sharedSessionId: number;
let noAudioTrackId: number;
let missingFileTrackId: number;
let candidateAssetId: number;
let contentTrackId: number;
let contentV1Id: number;
let contentV2Id: number;

/** Writes an empty stored file for `key`, so `storedFileExists` finds it. */
async function mkStoredFile(key: string) {
  const path = storedFilePath(key);
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await writeFile(path, "");
}

async function mkTrack(title: string) {
  const [track] = await db
    .insert(tracks)
    .values({ title, artists: [], projectId, priorityId })
    .returning({ id: tracks.id });
  return track!.id;
}

async function mkAsset(name: string, fingerprint: string | null = null) {
  const assetPath = `${dir}/${crypto.randomUUID()}-${name}`;
  const [asset] = await db
    .insert(assets)
    .values({
      name,
      type: "audio/wav",
      size: 0,
      assetPath,
      projectId,
      fingerprint,
    })
    .returning({ id: assets.id });
  return { id: asset!.id, assetPath };
}

async function mkVersion(
  trackId: number,
  assetId: number,
  version: number,
  extra: Partial<
    Omit<NewTrackAudio, "trackId" | "assetId" | "version" | "analysisVersion">
  > = {}
) {
  const [row] = await db
    .insert(trackAudios)
    .values({
      trackId,
      assetId,
      version,
      analysisVersion: ANALYSIS_VERSION,
      ...extra,
    })
    .returning({ id: trackAudios.id });
  return row!.id;
}

beforeAll(async () => {
  dir = `assets/audio-audit-test-${crypto.randomUUID()}`;

  const [project] = await db
    .insert(projects)
    .values({ name: `Audio Audit ${Date.now()}` })
    .returning({ id: projects.id });
  projectId = project!.id;
  priorityId = await seedScale(projectId);

  // Two tracks sharing one asset's fingerprint, plus a session on one of
  // them attached to that same asset.
  const shared = await mkAsset("shared-take.wav", "fp-shared");
  await mkStoredFile(shared.assetPath);
  sharedTrackId = await mkTrack("Shared A");
  sharedOtherTrackId = await mkTrack("Shared B");
  await mkVersion(sharedTrackId, shared.id, 1, {
    isPrimary: true,
    durationMs: 60_000,
    lufs: -14,
    truePeakDb: -3,
  });
  await mkVersion(sharedOtherTrackId, shared.id, 1, {
    isPrimary: true,
    durationMs: 60_000,
    lufs: -14,
    truePeakDb: -3,
  });
  const [sharedSession] = await db
    .insert(sessions)
    .values({
      name: "Shared Session",
      daw: "Ableton",
      projectId,
      priorityId,
      trackId: sharedTrackId,
    })
    .returning({ id: sessions.id });
  sharedSessionId = sharedSession!.id;
  await db
    .insert(sessionAttachments)
    .values({ sessionId: sharedSessionId, assetId: shared.id });

  // A track with no audio at all.
  noAudioTrackId = await mkTrack("No Audio");

  // A track whose only version's stored file is gone, with a session
  // carrying an asset that's attached but never linked as a version.
  missingFileTrackId = await mkTrack("Missing File");
  const gone = await mkAsset("gone.wav"); // never written to disk
  await mkVersion(missingFileTrackId, gone.id, 1, { isPrimary: true });

  const [session] = await db
    .insert(sessions)
    .values({
      name: "Session",
      daw: "Ableton",
      projectId,
      priorityId,
      trackId: missingFileTrackId,
    })
    .returning({ id: sessions.id });
  const candidate = await mkAsset("candidate-take.wav");
  candidateAssetId = candidate.id;
  await mkStoredFile(candidate.assetPath);
  await db
    .insert(sessionAttachments)
    .values({ sessionId: session!.id, assetId: candidate.id });

  // A track with two versions: v1 carries silence, clipping, tempo and key;
  // v2 duplicates v1's fingerprint.
  contentTrackId = await mkTrack("Content");
  const v1Asset = await mkAsset("content-v1.wav");
  await mkStoredFile(v1Asset.assetPath);
  contentV1Id = await mkVersion(contentTrackId, v1Asset.id, 1, {
    isPrimary: true,
    silence: { leadMs: 2_500, tailMs: 3_500 },
    clipping: [
      { binIndex: 0, samples: 10, over: false },
      { binIndex: 1, samples: 6, over: true },
    ],
    bpm: 120.5,
    bpmConfidence: 0.9,
    musicalKey: "F♯ minor",
    keyConfidence: 0.8,
  });
  const v2Asset = await mkAsset("content-v2.wav");
  await mkStoredFile(v2Asset.assetPath);
  contentV2Id = await mkVersion(contentTrackId, v2Asset.id, 2, {
    duplicateOfId: contentV1Id,
  });
});

afterAll(async () => {
  await db.delete(projects).where(eq(projects.id, projectId));
  await rm(storedFilePath(dir), { recursive: true, force: true });
});

describe("auditProjectAudio", () => {
  it("carries every field of the shape across a duplicate, a missing file, a track with no audio and an unlinked candidate", async () => {
    const audit = await auditProjectAudio(projectId);
    const byId = new Map(audit.tracks.map((t) => [t.trackId, t]));

    const sharedA = byId.get(sharedTrackId)!;
    expect(sharedA.title).toBe("Shared A");
    expect(sharedA.versions).toHaveLength(1);
    const sharedAVersion = sharedA.versions[0]!;
    expect(sharedAVersion).toMatchObject({
      version: 1,
      isPrimary: true,
      fileExists: true,
      analysis: {
        current: true,
        durationMs: 60_000,
        lufs: -14,
        lra: null,
        truePeakDb: -3,
      },
    });
    expect(sharedAVersion.asset.fingerprint).toBe("fp-shared");
    expect(sharedAVersion.asset.name).toBe("shared-take.wav");
    expect(sharedAVersion.sessions).toEqual([
      { id: sharedSessionId, name: "Shared Session", linkedToThisTrack: true },
    ]);
    expect(sharedA.unlinkedCandidates).toEqual([]);

    // The other track sharing the fingerprinted asset sees the same session,
    // but it isn't the session's own track.
    const sharedB = byId.get(sharedOtherTrackId)!;
    expect(sharedB.versions[0]!.sessions).toEqual([
      {
        id: sharedSessionId,
        name: "Shared Session",
        linkedToThisTrack: false,
      },
    ]);

    const noAudio = byId.get(noAudioTrackId)!;
    expect(noAudio.title).toBe("No Audio");
    expect(noAudio.versions).toEqual([]);
    expect(noAudio.unlinkedCandidates).toEqual([]);

    const missing = byId.get(missingFileTrackId)!;
    expect(missing.versions).toHaveLength(1);
    expect(missing.versions[0]!.fileExists).toBe(false);
    expect(missing.unlinkedCandidates).toEqual([
      { assetId: candidateAssetId, name: "candidate-take.wav" },
    ]);

    expect(audit.duplicateFingerprints).toHaveLength(1);
    const group = audit.duplicateFingerprints[0]!;
    expect(group.fingerprint).toBe("fp-shared");
    expect([...group.trackIds].sort((a, b) => a - b)).toEqual(
      [sharedTrackId, sharedOtherTrackId].sort((a, b) => a - b)
    );

    const content = byId.get(contentTrackId)!;
    const [contentV1, contentV2] = content.versions;
    expect(contentV1!.analysis).toMatchObject({
      silence: { leadMs: 2_500, tailMs: 3_500 },
      clippedBins: 2,
      clippedFrames: 16,
      clippedOverBins: 1,
      bpm: 120.5,
      bpmConfidence: 0.9,
      musicalKey: "F♯ minor",
      keyConfidence: 0.8,
      duplicateOfId: null,
    });
    expect(contentV2!.analysis).toMatchObject({
      silence: null,
      clippedBins: 0,
      clippedFrames: 0,
      clippedOverBins: 0,
      duplicateOfId: contentV1Id,
    });
    expect(contentV2!.id).toBe(contentV2Id);
  });

  it("scopes the read to the given trackIds", async () => {
    const audit = await auditProjectAudio(projectId, [noAudioTrackId]);
    expect(audit.tracks.map((t) => t.trackId)).toEqual([noAudioTrackId]);
  });
});

/** A minimal version for `audioFindings` fixtures, overridable per test. */
type FindingsVersion = AudioAudit["tracks"][number]["versions"][number];

function mkFindingsVersion(
  overrides: Partial<Omit<FindingsVersion, "analysis">> & {
    analysis?: Partial<FindingsVersion["analysis"]>;
  } = {}
): FindingsVersion {
  return {
    id: 1,
    version: 1,
    isPrimary: true,
    primaryPinned: false,
    asset: {
      id: 1,
      name: "take.wav",
      type: "audio/wav",
      size: 0,
      fingerprint: null,
      localFilepath: null,
      createdAt: new Date(),
    },
    sessions: [],
    fileExists: true,
    ...overrides,
    analysis: {
      current: true,
      durationMs: 60_000,
      lufs: -14,
      lra: 6,
      truePeakDb: -3,
      silence: null,
      clippedBins: 0,
      clippedFrames: 0,
      clippedOverBins: 0,
      bpm: null,
      bpmConfidence: null,
      musicalKey: null,
      keyConfidence: null,
      duplicateOfId: null,
      ...overrides.analysis,
    },
  };
}

function mkAudit(
  tracks: AudioAudit["tracks"],
  duplicateFingerprints: AudioAudit["duplicateFingerprints"] = []
): Omit<AudioAudit, "findings"> {
  return { tracks, duplicateFingerprints };
}

/** The thresholds a project that sets nothing audits against. */
const thresholds = DEFAULT_PROJECT_POLICY.audio;

const defaultFindings = (audit: Omit<AudioAudit, "findings">) =>
  audioFindings(audit, thresholds);

describe("audioFindings", () => {
  it("flags a track with no audio version, marking the fix when a candidate exists", () => {
    const withCandidate = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Empty",
          versions: [],
          unlinkedCandidates: [{ assetId: 9, name: "take.wav" }],
        },
      ])
    );
    expect(withCandidate).toContainEqual(
      expect.objectContaining({
        code: "no_audio",
        severity: "info",
        trackId: 1,
        fix: "link_audio_versions",
      })
    );

    const withoutCandidate = defaultFindings(
      mkAudit([
        { trackId: 1, title: "Empty", versions: [], unlinkedCandidates: [] },
      ])
    );
    expect(withoutCandidate).toContainEqual(
      expect.objectContaining({ code: "no_audio", fix: undefined })
    );
  });

  it("flags a track with versions but no primary", () => {
    const findings = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "No Primary",
          versions: [mkFindingsVersion({ isPrimary: false })],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "no_primary",
        severity: "warn",
        trackId: 1,
        fix: "set_primary_audio",
      })
    );
  });

  it("flags a stale primary when a newer version exists", () => {
    const findings = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Stale",
          versions: [
            mkFindingsVersion({ id: 1, version: 1, isPrimary: true }),
            mkFindingsVersion({ id: 2, version: 2, isPrimary: false }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "stale_primary",
        trackId: 1,
        trackAudioId: 2,
        fix: "set_primary_audio",
      })
    );
  });

  it("flags an unlinked candidate attached to a session", () => {
    const findings = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Has Candidate",
          versions: [mkFindingsVersion()],
          unlinkedCandidates: [{ assetId: 9, name: "extra-take.wav" }],
        },
      ])
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "unlinked_candidate",
        trackId: 1,
        fix: "link_audio_versions",
      })
    );
  });

  it("flags a version whose stored file is gone, and nothing else about it", () => {
    const findings = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Gone",
          versions: [mkFindingsVersion({ fileExists: false })],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(findings).toEqual([
      expect.objectContaining({
        code: "missing_file",
        severity: "error",
        trackId: 1,
        trackAudioId: 1,
        fix: "unlink_audio_version",
      }),
    ]);
  });

  it("flags a version whose analysis has not run, and nothing else about it", () => {
    const findings = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Unanalysed",
          versions: [
            mkFindingsVersion({
              analysis: {
                current: false,
                durationMs: null,
                lufs: null,
                lra: null,
                truePeakDb: null,
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(findings).toEqual([
      expect.objectContaining({
        code: "analysis_outstanding",
        severity: "warn",
        trackId: 1,
        trackAudioId: 1,
        fix: "queue_analysis",
      }),
    ]);
  });

  it("flags duration at and just past the too-short threshold", () => {
    const atThreshold = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Boundary",
          versions: [
            mkFindingsVersion({
              analysis: {
                current: true,
                durationMs: thresholds.auditTooShortSeconds * 1000,
                lufs: null,
                lra: null,
                truePeakDb: null,
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(atThreshold.some((finding) => finding.code === "too_short")).toBe(
      false
    );

    const pastThreshold = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Short",
          versions: [
            mkFindingsVersion({
              analysis: {
                current: true,
                durationMs: thresholds.auditTooShortSeconds * 1000 - 1,
                lufs: null,
                lra: null,
                truePeakDb: null,
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(pastThreshold).toContainEqual(
      expect.objectContaining({ code: "too_short", severity: "warn" })
    );
  });

  it("flags loudness at and just past the near-silent threshold", () => {
    const atThreshold = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Boundary",
          versions: [
            mkFindingsVersion({
              analysis: {
                current: true,
                durationMs: null,
                lufs: thresholds.auditNearSilentLufs,
                lra: null,
                truePeakDb: null,
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(atThreshold.some((finding) => finding.code === "near_silent")).toBe(
      false
    );

    const pastThreshold = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Quiet",
          versions: [
            mkFindingsVersion({
              analysis: {
                current: true,
                durationMs: null,
                lufs: thresholds.auditNearSilentLufs - 1,
                lra: null,
                truePeakDb: null,
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(pastThreshold).toContainEqual(
      expect.objectContaining({ code: "near_silent", severity: "warn" })
    );
  });

  it("flags a true peak at and just past the hot-peak threshold", () => {
    const atThreshold = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Boundary",
          versions: [
            mkFindingsVersion({
              analysis: {
                current: true,
                durationMs: null,
                lufs: null,
                lra: null,
                truePeakDb: thresholds.auditHotPeakDbtp,
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(atThreshold.some((finding) => finding.code === "hot_peak")).toBe(
      false
    );

    const pastThreshold = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Hot",
          versions: [
            mkFindingsVersion({
              analysis: {
                current: true,
                durationMs: null,
                lufs: null,
                lra: null,
                truePeakDb: thresholds.auditHotPeakDbtp + 1,
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(pastThreshold).toContainEqual(
      expect.objectContaining({ code: "hot_peak", severity: "info" })
    );
  });

  it("flags a name that reads like another track's title better than its own", () => {
    const findings = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Night Drive",
          versions: [
            mkFindingsVersion({
              asset: {
                ...mkFindingsVersion().asset,
                name: "canopy ambient outro.wav",
              },
            }),
          ],
          unlinkedCandidates: [],
        },
        { trackId: 2, title: "Canopy", versions: [], unlinkedCandidates: [] },
      ])
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "name_mismatch",
        trackId: 1,
        message: expect.stringContaining("Canopy"),
      })
    );
  });

  it("does not flag a name mismatch with no better-matching track", () => {
    const findings = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Night Drive",
          versions: [
            mkFindingsVersion({
              asset: { ...mkFindingsVersion().asset, name: "take-04.wav" },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(findings.some((finding) => finding.code === "name_mismatch")).toBe(
      false
    );
  });

  it("flags every track sharing a fingerprinted asset", () => {
    const findings = defaultFindings(
      mkAudit(
        [
          { trackId: 1, title: "A", versions: [], unlinkedCandidates: [] },
          { trackId: 2, title: "B", versions: [], unlinkedCandidates: [] },
        ],
        [{ fingerprint: "fp", trackIds: [1, 2] }]
      )
    );
    const duplicateFindings = findings.filter(
      (finding) => finding.code === "duplicate_across_tracks"
    );
    expect(duplicateFindings.map((finding) => finding.trackId).sort()).toEqual([
      1, 2,
    ]);
    expect(duplicateFindings[0]!.message).toContain("A");
    expect(duplicateFindings[0]!.message).toContain("B");
  });

  it("flags leading silence at and just past the long-lead threshold", () => {
    const atThreshold = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Boundary",
          versions: [
            mkFindingsVersion({
              analysis: {
                silence: {
                  leadMs: thresholds.auditLeadSilenceSeconds * 1000,
                  tailMs: 0,
                },
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(
      atThreshold.some((finding) => finding.code === "long_silence_lead")
    ).toBe(false);

    const pastThreshold = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Long Lead",
          versions: [
            mkFindingsVersion({
              analysis: {
                silence: {
                  leadMs: thresholds.auditLeadSilenceSeconds * 1000 + 1,
                  tailMs: 0,
                },
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(pastThreshold).toContainEqual(
      expect.objectContaining({ code: "long_silence_lead", severity: "info" })
    );
  });

  it("flags trailing silence at and just past the long-tail threshold", () => {
    const atThreshold = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Boundary",
          versions: [
            mkFindingsVersion({
              analysis: {
                silence: {
                  leadMs: 0,
                  tailMs: thresholds.auditTailSilenceSeconds * 1000,
                },
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(
      atThreshold.some((finding) => finding.code === "long_silence_tail")
    ).toBe(false);

    const pastThreshold = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Long Tail",
          versions: [
            mkFindingsVersion({
              analysis: {
                silence: {
                  leadMs: 0,
                  tailMs: thresholds.auditTailSilenceSeconds * 1000 + 1,
                },
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(pastThreshold).toContainEqual(
      expect.objectContaining({ code: "long_silence_tail", severity: "info" })
    );
  });

  it("flags a version with clipped bins, naming the bin count, total frames and over-peak bins", () => {
    const findings = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Song",
          versions: [
            mkFindingsVersion({
              asset: { ...mkFindingsVersion().asset, name: "take.wav" },
              version: 2,
              analysis: {
                clippedBins: 14,
                clippedFrames: 212,
                clippedOverBins: 3,
              },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "clipping",
        severity: "warn",
        message:
          '"Song" v2 (take.wav): 14 clipped 50 ms bins, 212 full-scale frames, 3 bins over 0 dBTP.',
      })
    );
  });

  it("does not flag clipping with no clipped bins", () => {
    const findings = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Clean",
          versions: [mkFindingsVersion({ analysis: { clippedBins: 0 } })],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(findings.some((finding) => finding.code === "clipping")).toBe(false);
  });

  it("flags a duplicate version, naming the version it duplicates", () => {
    const findings = defaultFindings(
      mkAudit([
        {
          trackId: 1,
          title: "Dupe",
          versions: [
            mkFindingsVersion({ id: 1, version: 1 }),
            mkFindingsVersion({
              id: 2,
              version: 2,
              isPrimary: false,
              analysis: { duplicateOfId: 1 },
            }),
          ],
          unlinkedCandidates: [],
        },
      ])
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "duplicate_version",
        severity: "warn",
        trackId: 1,
        trackAudioId: 2,
        fix: "unlink_audio_version",
        message: expect.stringContaining("v1"),
      })
    );
  });
});

describe("nameSimilarity", () => {
  it("is above the floor for a file name that shares tokens with the title", () => {
    expect(
      nameSimilarity("canopy ambient outro.wav", "Canopy")
    ).toBeGreaterThan(thresholds.auditNameMismatch);
  });

  it("is zero against a title sharing no tokens", () => {
    expect(nameSimilarity("canopy ambient outro.wav", "Night Drive")).toBe(0);
  });
});
