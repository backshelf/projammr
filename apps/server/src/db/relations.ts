import { defineRelations } from "drizzle-orm";
import { tables } from "./tables.js";

export const relations = defineRelations(tables, (r) => ({
  tracks: {
    sessions: r.many.sessions({
      from: r.tracks.id,
      to: r.sessions.trackId,
    }),
    attachments: r.many.assets({
      from: r.tracks.id.through(r.trackAttachments.trackId),
      to: r.assets.id.through(r.trackAttachments.assetId),
    }),
    audios: r.many.trackAudios({
      from: r.tracks.id,
      to: r.trackAudios.trackId,
    }),
    primaryAudio: r.one.trackAudios({
      from: r.tracks.id,
      to: r.trackAudios.trackId,
      where: {
        isPrimary: true,
      },
    }),
    status: r.one.statuses({
      from: r.tracks.statusId,
      to: r.statuses.id,
    }),
    priority: r.one.priorityLevels({
      from: r.tracks.priorityId,
      to: r.priorityLevels.id,
      optional: false,
    }),
    comments: r.many.comments({
      from: r.tracks.id,
      to: r.comments.targetId,
      where: {
        targetType: "track",
      },
    }),
    collections: r.many.collections({
      from: r.tracks.id.through(r.collectionTracks.trackId),
      to: r.collections.id.through(r.collectionTracks.collectionId),
    }),
    relationsFrom: r.many.trackRelations({
      from: r.tracks.id,
      to: r.trackRelations.fromTrackId,
    }),
    relationsTo: r.many.trackRelations({
      from: r.tracks.id,
      to: r.trackRelations.toTrackId,
    }),
    note: r.one.notes({
      from: r.tracks.id,
      to: r.notes.trackId,
    }),
  },
  trackRelations: {
    fromTrack: r.one.tracks({
      from: r.trackRelations.fromTrackId,
      to: r.tracks.id,
    }),
    toTrack: r.one.tracks({
      from: r.trackRelations.toTrackId,
      to: r.tracks.id,
    }),
    relationType: r.one.trackRelationTypes({
      from: r.trackRelations.relationTypeId,
      to: r.trackRelationTypes.id,
      optional: false,
    }),
  },
  trackAudios: {
    track: r.one.tracks({
      from: r.trackAudios.trackId,
      to: r.tracks.id,
    }),
    asset: r.one.assets({
      from: r.trackAudios.assetId,
      to: r.assets.id,
    }),
    comments: r.many.comments({
      from: r.trackAudios.id,
      to: r.comments.targetId,
      where: {
        targetType: "track_audio",
      },
    }),
  },
  sessions: {
    track: r.one.tracks(),
    repo: r.one.repos({
      from: r.sessions.repoId,
      to: r.repos.id,
    }),
    priority: r.one.priorityLevels({
      from: r.sessions.priorityId,
      to: r.priorityLevels.id,
      optional: false,
    }),
    attachments: r.many.assets({
      from: r.sessions.id.through(r.sessionAttachments.sessionId),
      to: r.assets.id.through(r.sessionAttachments.assetId),
    }),
    comments: r.many.comments({
      from: r.sessions.id,
      to: r.comments.targetId,
      where: {
        targetType: "session",
      },
    }),
  },
  collections: {
    tracks: r.many.tracks({
      from: r.collections.id.through(r.collectionTracks.collectionId),
      to: r.tracks.id.through(r.collectionTracks.trackId),
    }),
    attachments: r.many.assets({
      from: r.collections.id.through(r.collectionAttachments.collectionId),
      to: r.assets.id.through(r.collectionAttachments.assetId),
    }),
    status: r.one.statuses({
      from: r.collections.statusId,
      to: r.statuses.id,
    }),
    priority: r.one.priorityLevels({
      from: r.collections.priorityId,
      to: r.priorityLevels.id,
      optional: false,
    }),
    comments: r.many.comments({
      from: r.collections.id,
      to: r.comments.targetId,
      where: {
        targetType: "collection",
      },
    }),
  },
  projects: {
    attachments: r.many.assets({
      from: r.projects.id.through(r.projectAttachments.projectId),
      to: r.assets.id.through(r.projectAttachments.assetId),
    }),
    comments: r.many.comments({
      from: r.projects.id,
      to: r.comments.targetId,
      where: {
        targetType: "project",
      },
    }),
  },
  assets: {
    uploadedBy: r.one.users({
      from: r.assets.createdByUser,
      to: r.users.id,
    }),
  },
  users: {
    authSessions: r.many.authSessions(),
    accounts: r.many.accounts(),
    comments: r.many.comments({
      from: r.users.id,
      to: r.comments.userId,
    }),
  },
  authSessions: {
    user: r.one.users({
      from: r.authSessions.userId,
      to: r.users.id,
    }),
  },
  accounts: {
    user: r.one.users({
      from: r.accounts.userId,
      to: r.users.id,
    }),
  },
  activity: {
    user: r.one.users({
      from: r.activity.userId,
      to: r.users.id,
    }),
  },
  comments: {
    parent: r.one.comments({
      from: r.comments.parentId,
      to: r.comments.id,
    }),
    replies: r.many.comments({
      from: r.comments.id,
      to: r.comments.parentId,
    }),
    user: r.one.users({
      from: r.comments.userId,
      to: r.users.id,
    }),
    resolver: r.one.users({
      from: r.comments.resolvedBy,
      to: r.users.id,
    }),
  },
  notes: {
    track: r.one.tracks({
      from: r.notes.trackId,
      to: r.tracks.id,
    }),
    author: r.one.users({
      from: r.notes.authorId,
      to: r.users.id,
    }),
  },
}));
