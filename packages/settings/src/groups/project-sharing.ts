import { z } from "zod";
import { defineGroup, defineSetting, wholeNumber } from "../define.js";
import { optionsOf } from "../options.js";

/**
 * What a share link plays: the current version of what it names, or a
 * snapshot frozen at the moment it was made. Mirrors the server's
 * `SHARELINK_TYPES`; the server's `Sharelink["shareType"]` derives from this.
 */
export const SHARE_KINDS = ["connected", "snapshot"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

const SHARE_KIND_LABELS: Readonly<Record<ShareKind, string>> = {
  connected: "Current version",
  snapshot: "Snapshot",
};

/** Whether a share's guests see each other's comments, or only their own. */
export const SHARE_COMMENT_PRIVACIES = ["public", "private"] as const;
export type ShareCommentPrivacy = (typeof SHARE_COMMENT_PRIVACIES)[number];

const SHARE_COMMENT_PRIVACY_LABELS: Readonly<
  Record<ShareCommentPrivacy, string>
> = {
  public: "Guests see each other's comments",
  private: "Guests see only their own comments",
};

/** The roles an invite may grant, lowest to highest: mirrors the server's `AssignableRole`. */
export const INVITE_ROLES = ["viewer", "editor", "admin"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

const INVITE_ROLE_LABELS: Readonly<Record<InviteRole, string>> = {
  viewer: "Viewer",
  editor: "Editor",
  admin: "Admin",
};

/**
 * The lowest role that may create an invite. Mirrors the server's
 * `WhoMayInvite`, highest to lowest.
 */
export const WHO_MAY_INVITE_ROLES = ["owner", "admin", "editor"] as const;
export type WhoMayInvite = (typeof WHO_MAY_INVITE_ROLES)[number];

const WHO_MAY_INVITE_LABELS: Readonly<Record<WhoMayInvite, string>> = {
  owner: "The owner only",
  admin: "Admins and the owner",
  editor: "Editors and above",
};

export const group = defineGroup({
  id: "project-sharing",
  section: "project",
  label: "Sharing",
  description:
    "What a new share link and a new invite default to, and who this project lets create an invite.",
  order: 80,
});

export const settings = [
  defineSetting({
    key: "project-sharing.shareKind",
    group: "project-sharing",
    label: "New share link plays",
    description:
      "What a new share link plays when its creation names none: the current version, or a snapshot frozen at the moment it was made.",
    keywords: ["share", "link", "snapshot", "connected", "default"],
    scopes: ["project", "instance"],
    schema: z.enum(SHARE_KINDS),
    default: "connected",
    control: { kind: "select", options: optionsOf(SHARE_KIND_LABELS) },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-sharing.shareExpiresDays",
    group: "project-sharing",
    label: "New share links expire after",
    description:
      "Days a new share link stays open before it expires. Empty never expires.",
    keywords: ["share", "link", "expiry", "expires", "default"],
    scopes: ["project", "instance"],
    schema: wholeNumber(1, 3650).nullable(),
    default: null,
    control: {
      kind: "duration",
      unit: "d",
      min: 1,
      max: 3650,
      placeholder: "Never",
    },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-sharing.shareCommentPrivacy",
    group: "project-sharing",
    label: "New share link comments",
    description:
      "Whether a new share link's guests see each other's comments, or only their own, when its creation names neither.",
    keywords: ["share", "link", "comments", "privacy", "default"],
    scopes: ["project", "instance"],
    schema: z.enum(SHARE_COMMENT_PRIVACIES),
    default: "public",
    control: {
      kind: "select",
      options: optionsOf(SHARE_COMMENT_PRIVACY_LABELS),
    },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-sharing.shareDownloads",
    group: "project-sharing",
    label: "New share links allow downloads",
    description:
      "Whether a new share link lets its guests download, when its creation names none.",
    keywords: ["share", "link", "download", "default"],
    scopes: ["project", "instance"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-sharing.guestComments",
    group: "project-sharing",
    label: "Guests may comment",
    description: "Whether a share link takes new comments from guests at all.",
    keywords: ["share", "link", "comments", "guest"],
    scopes: ["project", "instance"],
    schema: z.boolean(),
    default: true,
    control: { kind: "toggle" },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-sharing.inviteRole",
    group: "project-sharing",
    label: "New invites grant",
    description: "The role a new invite grants when its creation names none.",
    keywords: ["invite", "role", "default"],
    scopes: ["project", "instance"],
    schema: z.enum(INVITE_ROLES),
    default: "viewer",
    control: { kind: "select", options: optionsOf(INVITE_ROLE_LABELS) },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-sharing.inviteDays",
    group: "project-sharing",
    label: "Invites stay acceptable for",
    description: "Days a new invite stays acceptable before it expires.",
    keywords: ["invite", "expiry", "expires", "default"],
    scopes: ["project", "instance"],
    schema: wholeNumber(1, 365),
    default: 7,
    control: { kind: "duration", unit: "d", min: 1, max: 365 },
    minRole: "admin",
    audience: "all",
  }),
  defineSetting({
    key: "project-sharing.whoMayInvite",
    group: "project-sharing",
    label: "Who may invite",
    description:
      "The lowest role that may create an invite. A caller below this role cannot create one.",
    keywords: ["invite", "role", "who", "gate"],
    scopes: ["project", "instance"],
    schema: z.enum(WHO_MAY_INVITE_ROLES),
    default: "admin",
    control: { kind: "select", options: optionsOf(WHO_MAY_INVITE_LABELS) },
    minRole: "admin",
    audience: "all",
  }),
];
