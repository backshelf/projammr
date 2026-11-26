import * as activity from "./schema/activity.js";
import * as assets from "./schema/assets.js";
import * as attachments from "./schema/attachments.js";
import * as auth from "./schema/auth.js";
import * as collections from "./schema/collections.js";
import * as comments from "./schema/comments.js";
import * as customFields from "./schema/custom-fields.js";
import * as images from "./schema/images.js";
import * as jobs from "./schema/jobs.js";
import * as labels from "./schema/labels.js";
import * as notes from "./schema/notes.js";
import * as oauth from "./schema/oauth.js";
import * as objects from "./schema/objects.js";
import * as priorityLevels from "./schema/priority-levels.js";
import * as projects from "./schema/projects.js";
import * as repos from "./schema/repos.js";
import * as savedViews from "./schema/saved-views.js";
import * as saves from "./schema/saves.js";
import * as sessionSamples from "./schema/session-samples.js";
import * as sessions from "./schema/sessions.js";
import * as sharelinks from "./schema/sharelinks.js";
import * as statuses from "./schema/statuses.js";
import * as trackAudioAnalysis from "./schema/track-audio-analysis.js";
import * as trackRelationTypes from "./schema/track-relation-types.js";
import * as tracks from "./schema/tracks.js";

/**
 * Every model in one object, which is the shape `defineRelations` and the
 * Better Auth adapter each take as a single argument. Nothing else reads
 * through here — a consumer imports the `schema/` module that owns what it
 * needs, and `drizzle-kit` finds the tables by scanning that folder.
 */
export const tables = {
  ...activity,
  ...assets,
  ...attachments,
  ...auth,
  ...collections,
  ...comments,
  ...customFields,
  ...images,
  ...jobs,
  ...labels,
  ...notes,
  ...oauth,
  ...objects,
  ...priorityLevels,
  ...projects,
  ...repos,
  ...savedViews,
  ...saves,
  ...sessionSamples,
  ...sessions,
  ...sharelinks,
  ...statuses,
  ...trackAudioAnalysis,
  ...trackRelationTypes,
  ...tracks,
};
