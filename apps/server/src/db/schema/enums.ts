import type { SettingScope } from "@workspace/settings";
import { pgEnum } from "drizzle-orm/pg-core";

export const rawMemberRoleEnum = [
  "owner",
  "admin",
  "editor",
  "viewer",
] as const;

export const memberRoleEnum = pgEnum("member_role", rawMemberRoleEnum);

/**
 * What an image belongs to, and therefore who may read it. A project image is
 * private to that project's members; a user image is an avatar, shown to
 * anyone who shares a screen with its owner (member lists, uploader columns);
 * an instance image is the instance's own branding, which only an instance
 * admin uploads and anyone may read, signed in or not.
 */
export const rawImageScopeEnum = ["project", "user", "instance"] as const;

export const imageScopeEnum = pgEnum("image_scope", rawImageScopeEnum);

/** The four entities that carry artwork, labels, activity and comments. */
export const rawEntityKindEnum = [
  "project",
  "collection",
  "track",
  "session",
] as const;

/** An activity row names one of the entities, so the two lists are one list. */
export const activityTargetEnum = pgEnum(
  "activity_target_type",
  rawEntityKindEnum
);

/** The entities, plus the audio version a timestamped comment hangs off. */
export const rawCommentTargetEnum = [
  ...rawEntityKindEnum,
  "track_audio",
] as const;

export const commentTargetEnum = pgEnum(
  "comment_target_type",
  rawCommentTargetEnum
);

export const rawLabelTargetEnum = ["track", "collection", "session"] as const;

export const labelTargetEnum = pgEnum("label_target_type", rawLabelTargetEnum);

export const rawSavedViewKindEnum = ["track", "collection", "session"] as const;

export const savedViewKindEnum = pgEnum(
  "saved_view_kind",
  rawSavedViewKindEnum
);

export const rawActivityActionEnum = [
  "created",
  "updated",
  "deleted",
  "commented",
  "archived",
  "unarchived",
  "resolved",
  "reopened",
] as const;

export const activityActionEnum = pgEnum(
  "activity_action",
  rawActivityActionEnum
);

export const rawJobKindEnum = [
  "audio_analysis",
  "convert",
  "audio_backfill",
  "image_variants",
  "storage_audit",
  "save_content_sweep",
] as const;

export const jobKindEnum = pgEnum("job_kind", rawJobKindEnum);

export const rawJobStatusEnum = [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
] as const;

export const jobStatusEnum = pgEnum("job_status", rawJobStatusEnum);

/**
 * What a storage counter is kept for: a project's files, or everything one
 * user put on the instance. A file counts towards both — they are two views of
 * the same bytes, not two halves of them.
 */
export const rawStorageScopeEnum = ["project", "user"] as const;

export const storageScopeEnum = pgEnum("storage_scope", rawStorageScopeEnum);

/**
 * How a session save was captured: a scanner pass, a DAW backup file, a client
 * save, or a dit commit.
 */
export const rawSaveSourceEnum = ["scan", "backup", "app", "dit"] as const;

export const saveSourceEnum = pgEnum("save_source", rawSaveSourceEnum);

export type SaveSource = (typeof rawSaveSourceEnum)[number];

/**
 * Whether a save's content is held: `none` is metadata only, `stored` holds the
 * content, and `pruned` had its content dropped by retention with the row kept.
 */
export const rawContentStateEnum = ["none", "stored", "pruned"] as const;

export const contentStateEnum = pgEnum("content_state", rawContentStateEnum);

/**
 * Who made a dit commit: a `user` committed it, a `checkpoint` is one dit took
 * itself.
 */
export const rawCommitKindEnum = ["user", "checkpoint"] as const;

export const commitKindEnum = pgEnum("commit_kind", rawCommitKindEnum);

/**
 * Where a span of time the set was open came from: a script run, a log line,
 * a window title, or the saves the set was pushed with.
 */
export const rawSegmentSourceEnum = [
  "script",
  "log",
  "title",
  "saves",
] as const;

export const segmentSourceEnum = pgEnum("segment_source", rawSegmentSourceEnum);

/**
 * What an account may do to the instance itself, as opposed to any one
 * project. An `admin` administers the instance — settings, accounts and the
 * seeded vocabulary every project shares; everyone else is a `user`, whose
 * reach stops at the projects they are a member of.
 */
export const rawInstanceRoleEnum = ["admin", "user"] as const;

export const instanceRoleEnum = pgEnum("instance_role", rawInstanceRoleEnum);

/**
 * What an admin action on an account did, as `admin_audit` names it. A role
 * change and a disable/enable each get their own value rather than one
 * "updated" so a `PATCH /admin/users/:id` that touches both role and
 * disabled state writes one row per distinct thing that changed.
 */
export const rawAdminAuditActionEnum = [
  "reset_link_issued",
  "role_changed",
  "account_disabled",
  "account_enabled",
  "account_self_deleted",
] as const;

export const adminAuditActionEnum = pgEnum(
  "admin_audit_action",
  rawAdminAuditActionEnum
);

/**
 * The scopes whose settings changes `settings_audit` records: the shared ones
 * an owner or an admin governs. A user's own settings are theirs alone and go
 * unrecorded.
 */
export const rawSettingsAuditScopeEnum = [
  "project",
  "instance",
] as const satisfies readonly SettingScope[];

export const settingsAuditScopeEnum = pgEnum(
  "settings_audit_scope",
  rawSettingsAuditScopeEnum
);
