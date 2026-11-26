import { SETTINGS, type SettingsValues } from "@workspace/settings";
import { settings as conventionSettings } from "@workspace/settings/groups/project-conventions";
import { settings as defaultSettings } from "@workspace/settings/groups/project-defaults";
import {
  settings as audioSettings,
  type DuplicateKeep,
} from "@workspace/settings/groups/project-audio";
import {
  settings as sharingSettings,
  type ShareCommentPrivacy,
  type ShareKind,
  type WhoMayInvite,
} from "@workspace/settings/groups/project-sharing";
import type { Sharelink } from "../schema/sharelinks.js";
import type { AssignableRole } from "./authorization.js";
import { projectValues } from "./settings.js";

export type { DuplicateKeep };

type SameUnion<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;

type Assert<T extends true> = T;

/**
 * Compiles only while the share kinds the settings group offers are exactly the ones a share link is stored with.
 * @public the assertion is its own use, so the export only marks it as not dead.
 */
export type ShareKindsMatchStorage = Assert<
  SameUnion<ShareKind, Sharelink["shareType"]>
>;

/**
 * Everything that shapes a project without being one of its rows: what a new
 * entity gets for what its create leaves out, how sharing and invites behave,
 * the windows the project's home reads, and the audio pipeline's thresholds.
 * Read per use through {@link projectPolicy}.
 */
export type ProjectPolicy = {
  /** What a create fills in for whatever its body leaves out; a body that names a value keeps it. */
  defaults: {
    /** A new track's status. One the project cannot use is skipped for the column default. */
    trackStatusId: number;
    /** A new collection's status, skipped the same way. */
    collectionStatusId: number;
    /** The labels a new track or collection carries. An id the project no longer has is skipped. */
    labelIds: number[];
    /** A new track's artists. */
    artists: string[];
    /** Whether a new track is marked explicit. */
    explicit: boolean;
    /** Whether a new session linked to a track becomes its main, taking over from the one before. */
    newSessionMain: boolean;
  };
  sharing: {
    /** The kind of share link a share dialog opens on. */
    shareKind: Sharelink["shareType"];
    /** Days a new share link lives; null never expires. */
    shareExpiresDays: number | null;
    shareCommentPrivacy: ShareCommentPrivacy;
    /** Whether a new share link lets its guests download. */
    shareDownloads: boolean;
    /** Whether a share link takes new comments at all. */
    guestComments: boolean;
    /** The role an invite grants when its request names none. */
    inviteRole: AssignableRole;
    /** Days an invite stays acceptable. */
    inviteDays: number;
    whoMayInvite: WhoMayInvite;
  };
  conventions: {
    /** Days untouched before a track counts as quiet; 0 counts nothing quiet. */
    quietAfterDays: number;
    /** Hours back a render or a save still counts as new on the project's home. */
    todayNewHours: number;
  };
  audio: {
    /** A version shorter than this is flagged too short. */
    auditTooShortSeconds: number;
    /** A version quieter than this integrated loudness is flagged near-silent. */
    auditNearSilentLufs: number;
    /** A version whose true peak passes this is flagged hot. */
    auditHotPeakDbtp: number;
    /** Leading silence longer than this is flagged. */
    auditLeadSilenceSeconds: number;
    /** Trailing silence longer than this is flagged. */
    auditTailSilenceSeconds: number;
    /** The file-name-to-title similarity below which a version's name can read as another track's. */
    auditNameMismatch: number;
    /** Whether analysis settles a detected tempo octave and key mode against the track's main session. */
    tempoKeyCorrection: boolean;
    /** How close, in percent of the session tempo, a doubled or halved tempo must land to be taken. */
    tempoKeyCorrectionPercent: number;
    /** How far apart two formats of one bounce can have been written. */
    sameBounceWindowMinutes: number;
    duplicateKeep: DuplicateKeep;
    /** The bitrate an MP3 conversion uses when its request names none. */
    mp3Kbps: number;
    /** Whether linking a version queues its analysis, and whether a boot fills in what is outstanding. */
    autoAnalyse: boolean;
    /** The project's own storage cap; the instance's cap still applies above it. Null sets none. */
    storageCapGb: number | null;
  };
};

/** Every setting the policy is read from, one per field of {@link ProjectPolicy}. */
const POLICY_KEYS = [
  ...defaultSettings,
  ...sharingSettings,
  ...conventionSettings,
  ...audioSettings,
].map(({ key }) => key);

type PolicyKey = (typeof POLICY_KEYS)[number];

/**
 * A policy from the value `valueOf` gives each setting. The MP3 bitrate is a
 * string the settings' select control edits, and a number here.
 */
function policyOf(valueOf: <K extends PolicyKey>(key: K) => SettingsValues[K]) {
  return {
    defaults: {
      trackStatusId: valueOf("project-defaults.trackStatusId"),
      collectionStatusId: valueOf("project-defaults.collectionStatusId"),
      labelIds: valueOf("project-defaults.labelIds"),
      artists: valueOf("project-defaults.artists"),
      explicit: valueOf("project-defaults.explicit"),
      newSessionMain: valueOf("project-defaults.newSessionMain"),
    },
    sharing: {
      shareKind: valueOf("project-sharing.shareKind"),
      shareExpiresDays: valueOf("project-sharing.shareExpiresDays"),
      shareCommentPrivacy: valueOf("project-sharing.shareCommentPrivacy"),
      shareDownloads: valueOf("project-sharing.shareDownloads"),
      guestComments: valueOf("project-sharing.guestComments"),
      inviteRole: valueOf("project-sharing.inviteRole"),
      inviteDays: valueOf("project-sharing.inviteDays"),
      whoMayInvite: valueOf("project-sharing.whoMayInvite"),
    },
    conventions: {
      quietAfterDays: valueOf("project-conventions.quietAfterDays"),
      todayNewHours: valueOf("project-conventions.todayNewHours"),
    },
    audio: {
      auditTooShortSeconds: valueOf("project-audio.auditTooShortSeconds"),
      auditNearSilentLufs: valueOf("project-audio.auditNearSilentLufs"),
      auditHotPeakDbtp: valueOf("project-audio.auditHotPeakDbtp"),
      auditLeadSilenceSeconds: valueOf("project-audio.auditLeadSilenceSeconds"),
      auditTailSilenceSeconds: valueOf("project-audio.auditTailSilenceSeconds"),
      auditNameMismatch: valueOf("project-audio.auditNameMismatch"),
      tempoKeyCorrection: valueOf("project-audio.tempoKeyCorrection"),
      tempoKeyCorrectionPercent: valueOf(
        "project-audio.tempoKeyCorrectionPercent"
      ),
      sameBounceWindowMinutes: valueOf("project-audio.sameBounceWindowMinutes"),
      duplicateKeep: valueOf("project-audio.duplicateKeep"),
      mp3Kbps: Number(valueOf("project-audio.mp3Kbps")),
      autoAnalyse: valueOf("project-audio.autoAnalyse"),
      storageCapGb: valueOf("project-audio.storageCapGb"),
    },
  } satisfies ProjectPolicy;
}

/** The policy of a project that sets nothing: the settings' defaults. */
export const DEFAULT_PROJECT_POLICY: ProjectPolicy = policyOf(
  (key) => SETTINGS[key].default as SettingsValues[typeof key]
);

/**
 * Where a project's policy comes from: its settings, resolved project row,
 * then the instance's, then the default, all read afresh. Each read is a
 * fresh copy, so no caller can change what the next one sees.
 */
async function readProjectPolicy(projectId: number): Promise<ProjectPolicy> {
  const values = await projectValues(projectId, POLICY_KEYS);
  return structuredClone(
    policyOf((key) => values[key] as SettingsValues[typeof key])
  );
}

/** Some fields of some sections, laid over a policy. */
export type ProjectPolicyPatch = {
  [Section in keyof ProjectPolicy]?: Partial<ProjectPolicy[Section]>;
};

/** Patches a test has laid over a project's policy, by project id. */
const testPatches = new Map<number, ProjectPolicyPatch>();

/**
 * A project's policy, read afresh on every call: a caller reads it once for
 * the operation in hand and keeps it no longer than that.
 */
export async function projectPolicy(projectId: number): Promise<ProjectPolicy> {
  const policy = await readProjectPolicy(projectId);
  const patch = testPatches.get(projectId);
  if (!patch) return policy;
  return {
    defaults: { ...policy.defaults, ...patch.defaults },
    sharing: { ...policy.sharing, ...patch.sharing },
    conventions: { ...policy.conventions, ...patch.conventions },
    audio: { ...policy.audio, ...patch.audio },
  };
}

/**
 * Test-only: runs `run` with `patch` laid over one project's policy, and lifts
 * it again however `run` ends. Scoped to the project and to the callback, so a
 * patch can neither reach another suite's project nor outlive its test when
 * several files share one module graph.
 */
export async function withProjectPolicyForTest<T>(
  projectId: number,
  patch: ProjectPolicyPatch,
  run: () => Promise<T>
): Promise<T> {
  const previous = testPatches.get(projectId);
  testPatches.set(projectId, patch);
  try {
    return await run();
  } finally {
    if (previous) testPatches.set(projectId, previous);
    else testPatches.delete(projectId);
  }
}
