import { components, operations } from "./v1";

export type { ActionError } from "./action-result";

export type Project =
  operations["getApiProjectsById"]["responses"][200]["content"]["application/json"];

export type NewProject =
  operations["postApiProjects"]["requestBody"]["content"]["application/json"];

/**
 * The signed-in user as they read themselves: the contact details no one
 * else's view of them carries, and their own instance role.
 */
export type Me =
  operations["getApiMe"]["responses"][200]["content"]["application/json"];

/**
 * A project as it appears in the signed-in user's own list — the project row
 * alone, with none of the membership or artwork a single project carries.
 */
export type MyProject =
  operations["getApiMeProjects"]["responses"][200]["content"]["application/json"][number];

/**
 * What deleting the signed-in user's own account would do: the projects that
 * block it because another member still shares them, and the projects that
 * go with it because no one else is in them.
 */
export type DeletionPlan =
  operations["getApiMeDeletionPlan"]["responses"][200]["content"]["application/json"];

/** One project in a `DeletionPlan`. */
export type DeletionPlanProject = DeletionPlan["blocking"][number];

/** Syllable count and rhyme-scheme key for one word, as returned by the batch analyze endpoint. */
export type WordAnalysis =
  operations["postApiLyricsAnalyze"]["responses"][200]["content"]["application/json"]["words"][number];

/** Perfect and near rhyme candidates for a word. */
export type RhymeResult =
  operations["getApiLyricsRhymes"]["responses"][200]["content"]["application/json"];

/** Synonym senses for a word, grouped by part of speech. */
export type SynonymResult =
  operations["getApiLyricsSynonyms"]["responses"][200]["content"]["application/json"];

/** One row of the signed-in user's notebook, as the list never opens a body. */
export type NoteSummary =
  operations["getApiNotes"]["responses"][200]["content"]["application/json"][number];

/** A note with its body, version and the caller's rights over it. */
export type NoteDetail =
  operations["getApiNotesById"]["responses"][200]["content"]["application/json"];

/** A save to a note: the version last read, plus whichever fields changed. */
export type NotePatch =
  operations["patchApiNotesById"]["requestBody"]["content"]["application/json"];

/** A note as it is first created: a body, and an optional track to link it to immediately. */
export type NewNote =
  operations["postApiNotes"]["requestBody"]["content"]["application/json"];

export type Collection = Omit<
  GetCollection,
  "attachments" | "status" | "tracks" | "comments" | "labels" | "artwork"
>;

export type GetCollection =
  operations["getApiCollectionsById"]["responses"][200]["content"]["application/json"];

export type NewCollection =
  operations["postApiCollections"]["requestBody"]["content"]["application/json"];

export type Track = Omit<
  GetTrack,
  "attachments" | "sessions" | "status" | "collections" | "labels" | "artwork"
>;

export type GetTrack =
  operations["getApiTracksById"]["responses"][200]["content"]["application/json"];

export type TrackRelationEdge = GetTrack["relations"][number];

/** A relation type as a relation carries it: its id and its name. */
export type RelationType = components["schemas"]["RelationType"];

/**
 * One of a project's relation types as its list answers it, in list order:
 * its place in the list and how many track relations use it.
 */
export type RelationTypeEntry =
  operations["getApiProjectsByIdRelationTypes"]["responses"][200]["content"]["application/json"][number];

/** A type as a create or a rename answers it: its place in the list, with no usage count. */
export type RankedRelationType =
  operations["postApiProjectsByIdRelationTypes"]["responses"][201]["content"]["application/json"];

export type AddTrackRelationRequest =
  operations["postApiTracksByIdRelations"]["requestBody"]["content"]["application/json"];

export type CollectionTotalStatus =
  operations["getApiCollectionsByIdStatus"]["responses"][200]["content"]["application/json"];

/** A collection's loudness spread, null until any primary audio is measured. */
export type CollectionLoudness = CollectionTotalStatus["loudness"];

/** A collection's spectral envelope, null until any primary audio is measured. */
export type CollectionSpectrum = CollectionTotalStatus["spectrum"];

/** A collection's tempo spread, null until any primary audio is measured. */
export type CollectionTempo = CollectionTotalStatus["tempo"];

/** One track's own detected key, as `CollectionKeys`' circle of fifths draws
 *  a dot per track. */
export type CollectionKeyTrack = CollectionTotalStatus["keys"][number];

export type TracksInCollection =
  operations["getApiCollectionsByIdTracks"]["responses"][200]["content"]["application/json"];

export type TrackInCollection =
  operations["postApiCollectionsByIdTracks"]["responses"][200]["content"]["application/json"];

export type NewTrack =
  operations["postApiTracks"]["requestBody"]["content"]["application/json"];

export type Session = Omit<
  GetSession,
  "attachments" | "track" | "comments" | "labels" | "artwork"
>;

export type GetSession =
  operations["getApiSessionsById"]["responses"][200]["content"]["application/json"];

export type NewSession =
  operations["postApiSessions"]["requestBody"]["content"]["application/json"];

export type TracksPage =
  operations["getApiProjectsByIdTracksPaginated"]["responses"][200]["content"]["application/json"];

/**
 * The `/tracks/paginated` route's own query params, `pageSize` dropped: the
 * client reads the page size back from the envelope and never sends one.
 */
export type TracksPageQuery = Omit<
  NonNullable<
    operations["getApiProjectsByIdTracksPaginated"]["parameters"]["query"]
  >,
  "pageSize"
>;

export type CollectionsPage =
  operations["getApiProjectsByIdCollectionsPaginated"]["responses"][200]["content"]["application/json"];

/**
 * The `/collections/paginated` route's own query params, `pageSize` dropped:
 * the client reads the page size back from the envelope and never sends one.
 */
export type CollectionsPageQuery = Omit<
  NonNullable<
    operations["getApiProjectsByIdCollectionsPaginated"]["parameters"]["query"]
  >,
  "pageSize"
>;

export type SessionsPage =
  operations["getApiProjectsByIdSessionsPaginated"]["responses"][200]["content"]["application/json"];

/**
 * The `/sessions/paginated` route's own query params, `pageSize` dropped: the
 * client reads the page size back from the envelope and never sends one.
 */
export type SessionsPageQuery = Omit<
  NonNullable<
    operations["getApiProjectsByIdSessionsPaginated"]["parameters"]["query"]
  >,
  "pageSize"
>;

/**
 * A track as a listing returns it. Its `sessions` carry only the fields the
 * table renders directly; the full rows come from `getApiTracksByIdSessions`
 * when a track's sub-rows are expanded.
 */
export type ListTrack = TracksPage["rows"][number];

/** A session on a listed track: enough to link it and derive key/BPM. */
export type TrackSessionSummary = ListTrack["sessions"][number];

/** A collection as a listing returns it — see {@link ListTrack}. */
export type ListCollection = CollectionsPage["rows"][number];

/** A session as a listing returns it — see {@link ListTrack}. */
export type ListSession = SessionsPage["rows"][number];

/** Faceted option counts keyed by facet name → stringified value → count. */
export type Facets = TracksPage["facets"];

/** One group of a grouped page: stable key, header label, cross-page count. */
export type GroupSummary = TracksPage["groups"][number];

export type MemberRole = Project["role"];

/** The roles member management can assign; ownership moves only by transfer. */
export type AssignableRole =
  operations["patchApiProjectsByIdMembersByUserId"]["requestBody"]["content"]["application/json"]["role"];

export type ProjectMember =
  operations["getApiProjectsByIdMembers"]["responses"][200]["content"]["application/json"][number];

export type ProjectInvite =
  operations["getApiProjectsByIdInvites"]["responses"][200]["content"]["application/json"][number];

export type NewInvite =
  operations["postApiProjectsByIdInvites"]["requestBody"]["content"]["application/json"];

export type InvitePreview =
  operations["getApiInvitesByToken"]["responses"][200]["content"]["application/json"];

export type Status =
  operations["getApiStatusesById"]["responses"][200]["content"]["application/json"];

export type Label =
  operations["getApiProjectsByIdLabels"]["responses"][200]["content"]["application/json"][number];

/** A priority level as a row carries it: its name, its colour and its place on the project's scale. */
export type PriorityLevel = components["schemas"]["PriorityLevel"];

/**
 * One level of a project's priority scale, which the scale lists bottom level
 * first: the level, whether new rows take it by default, and how many rows of
 * each kind hold it.
 */
export type PriorityScaleLevel =
  operations["getApiProjectsByIdPriorities"]["responses"][200]["content"]["application/json"][number];

/**
 * One line of a move's report: `count` moved rows held the level `from`, which
 * the destination has no level of that name for, so they took its default `to`.
 */
export type PriorityFallback =
  operations["postApiTracksBulkMove"]["responses"][200]["content"]["application/json"]["priorityFallbacks"][number];

/**
 * One line of a move's report: a custom field some of whose values the move
 * drops (the destination has no field of the same kind, name and type, or no
 * select option of the same label), and how many.
 */
export type DroppedField =
  operations["postApiTracksBulkMove"]["responses"][200]["content"]["application/json"]["droppedFields"][number];

/** What a move reports beyond the rows it moved. */
export type MoveReport = {
  droppedFields: DroppedField[];
  priorityFallbacks: PriorityFallback[];
};

/**
 * A field a project defines on its tracks or its collections, with how many
 * entities hold a value for it. Rows carry their values in a `fields` bag
 * keyed `cf_<id>`.
 */
export type CustomField =
  operations["getApiProjectsByIdFields"]["responses"][200]["content"]["application/json"][number];

export type CustomFieldKind = CustomField["kind"];

export type CustomFieldType = CustomField["type"];

/** One choice of a select field; a value of the field stores its `id`. */
export type CustomFieldOption = CustomField["options"][number];

/** A field to create; a select's options may omit `id` and get one. */
export type NewCustomField =
  operations["postApiProjectsByIdFields"]["requestBody"]["content"]["application/json"];

/** A field's rename or options edit; its kind and type are fixed. */
export type CustomFieldEdit =
  operations["patchApiProjectsByIdFieldsByFieldId"]["requestBody"]["content"]["application/json"];

export type Activity =
  operations["getApiProjectsByIdActivity"]["responses"][200]["content"]["application/json"][number];

export type SavedView =
  operations["getApiProjectsByIdSavedViews"]["responses"][200]["content"]["application/json"][number];

export type SavedViewKind = SavedView["kind"];

export type NewSavedView =
  operations["postApiProjectsByIdSavedViews"]["requestBody"]["content"]["application/json"];

/** One page of a project's images. */
export type ImagesPage =
  operations["getApiImagesProjectByProjectId"]["responses"][200]["content"]["application/json"];

export type Image =
  operations["getApiImagesById"]["responses"][200]["content"]["application/json"];

/**
 * As {@link Image}, plus the id of the resize job the upload queued — `null`
 * for an avatar, which has no project to run one in.
 */
export type ImageUploadResult =
  operations["postApiImagesUpload"]["responses"][201]["content"]["application/json"];

export type Link = { name: string; url: string };

export type Asset =
  operations["postApiAssetsUpload"]["responses"][201]["content"]["application/json"];

/** A dit repo with its sets, each set's session and its branches' tip commits. */
export type Repo =
  operations["getApiReposById"]["responses"][200]["content"]["application/json"];

/** What a project is holding, and the cap it is measured against where there is one. */
export type ProjectStorage =
  operations["getApiProjectsByIdStorage"]["responses"][200]["content"]["application/json"];

/** One page of a project's files. */
export type AssetsPage =
  operations["getApiAssetsProjectByProjectId"]["responses"][200]["content"]["application/json"];

/** A project's audio uploaded in several formats, grouped by bounce. */
export type DuplicateAudio =
  operations["getApiAssetsProjectByProjectIdDuplicates"]["responses"][200]["content"]["application/json"];

export type DuplicateAudioGroup = DuplicateAudio["groups"][number];

/** An asset plus its uploader and the entities it is attached to. */
export type AssetWithContext = AssetsPage["rows"][number];

export type AssetAttachment = AssetWithContext["attachments"][number];

/** An asset as an entity's attachment row: the asset plus its uploader (`null` when the asset has no uploading user, including once the uploader has deleted their account). */
export type AttachedAsset = GetTrack["attachments"][number];

export type CommentWithReplies =
  operations["getApiCommentsByTargetTypeByTargetId"]["responses"][200]["content"]["application/json"][number];

export type CommentWithUser =
  operations["postApiComments"]["responses"][201]["content"]["application/json"];

export type NewComment =
  operations["postApiComments"]["requestBody"]["content"]["application/json"];

export type EditComment = Omit<
  NewComment,
  "targetType" | "targetId" | "userId"
>;

export type SessionsInProject =
  operations["getApiProjectsByIdSessions"]["responses"][200]["content"]["application/json"];

/** One DAW a project's sessions are tagged with: its module id and, if known, its display name. */
export type SessionDaw =
  operations["getApiProjectsByIdSessionsDaws"]["responses"][200]["content"]["application/json"][number];

export type UpdateStatusAction<T> = (
  entityId: number,
  statusId: number
) => Promise<T | ActionError>;

export type SessionSave =
  operations["getApiSessionsByIdSaves"]["responses"][200]["content"]["application/json"][number];

/** One dit commit of a session with the saves it covers, its author's name, its sample counts and the seconds the set was open across it. */
export type SessionCommit =
  operations["getApiSessionsByIdCommits"]["responses"][200]["content"]["application/json"][number];

/** The DAW-derived fields a save records: what the file looked like at one save. */
export type SaveMeta = NonNullable<SessionSave["meta"]>;

/** A session's parsed shape: its tracks, what is on each of them, and its clip counts. */
export type SessionStructure = NonNullable<SaveMeta["structure"]>;

export type SessionTrack = SessionStructure["tracks"][number];

/** One device across a project: how many sessions and tracks carry it, and where it comes from. */
export type PluginUsage =
  operations["getApiProjectsByIdPlugins"]["responses"][200]["content"]["application/json"][number];

/** The third-party plugin format a device on a track chain was hosted in. */
export type PluginHost = NonNullable<
  SessionStructure["plugins"]
>[string]["host"];

/** A session that carries a given device, with the tracks that carry it. */
export type PluginSession =
  operations["getApiProjectsByIdPluginsSessions"]["responses"][200]["content"]["application/json"][number];

/** One sample path across a project: the sessions that reference it and whether any reports it missing. */
export type SampleUsage =
  operations["getApiProjectsByIdSamples"]["responses"][200]["content"]["application/json"][number];

/** A session that references a given sample path, with its status for that path. */
export type SampleSession =
  operations["getApiProjectsByIdSamplesSessions"]["responses"][200]["content"]["application/json"][number];

/** One session file's whole sample list, as a scan records it by local path. */
export type SessionSamplesEntry =
  operations["putApiProjectsByIdSessionsSamples"]["requestBody"]["content"]["application/json"][number];

/**
 * A save as a project's feed reports it: the save, the session it
 * belongs to, and the previous save's metadata, flattened onto one object.
 */
export type ProjectSave =
  operations["getApiProjectsByIdSaves"]["responses"][200]["content"]["application/json"][number];

/**
 * What a project's home page reads: the renders linked and saves made in the
 * last day, and the tracks gone quiet with their total.
 */
export type ProjectToday =
  operations["getApiProjectsByIdToday"]["responses"][200]["content"]["application/json"];

/** A live, unfinished track nobody has touched for a month, as the project's today read reports it. */
export type QuietTrack = ProjectToday["quiet"]["tracks"][number];

/** One local calendar day's worth of session-save activity. */
export type HeatmapDay =
  operations["getApiProjectsByIdHeatmap"]["responses"][200]["content"]["application/json"][number];

/** A day on the cross-project heatmap, which also counts the projects worked on. */
export type UserHeatmapDay =
  operations["getApiMeHeatmap"]["responses"][200]["content"]["application/json"][number];

/**
 * A track's audio version with the asset behind it, as the track detail
 * response carries it.
 */
export type TrackAudioWithAsset = GetTrack["audios"][number];

/**
 * As {@link TrackAudioWithAsset}, plus the `owner` metadata the audio
 * endpoints send so the player can draw its card from one response.
 */
export type PlayableTrackAudio =
  operations["getApiTracksByIdAudios"]["responses"][200]["content"]["application/json"][number];

/** What the player shows beside a queued audio. */
export type AudioOwner = NonNullable<PlayableTrackAudio["owner"]>;

/** A resolved cover: the file to show plus its accent bin. */
export type Artwork = NonNullable<GetTrack["artwork"]>;

export type TrackAudio = Omit<TrackAudioWithAsset, "asset">;

export type CandidateAudio =
  operations["getApiTracksByIdCandidateAudios"]["responses"][200]["content"]["application/json"][number];

/** The stored comparison between two versions of the same track. */
export type TrackAudioDiff =
  operations["getApiTrackAudiosByIdDiffByOtherId"]["responses"][200]["content"]["application/json"];

export type LinkTrackAudiosRequest =
  operations["postApiTracksByIdAudios"]["requestBody"]["content"]["application/json"];

/**
 * What linking assets to a track as audio versions returns: the versions
 * themselves, plus the ids of any `audio_analysis` jobs the link queued.
 */
export type LinkTrackAudiosResult =
  operations["postApiTracksByIdAudios"]["responses"][201]["content"]["application/json"];

export type CollectionPrimaryAudios =
  operations["getApiCollectionsByIdAudiosPrimary"]["responses"][200]["content"]["application/json"];

/**
 * The list shapes the sidebar and pickers read: an id, a name, and the few
 * fields a link needs. The `Get*` types above carry each row's tracks,
 * comments and attachments, which those callers never look at.
 */
export type CollectionSummary =
  operations["getApiProjectsByIdCollectionsSummary"]["responses"][200]["content"]["application/json"][number];

export type TrackSummary =
  operations["getApiProjectsByIdTracksSummary"]["responses"][200]["content"]["application/json"][number];

export type SessionSummary =
  operations["getApiProjectsByIdSessionsSummary"]["responses"][200]["content"]["application/json"][number];

export type CollectionTrackSummary =
  operations["getApiCollectionsByIdTracksSummary"]["responses"][200]["content"]["application/json"][number];

/** A unit of background work: what it is doing, how far along, and its result. */
export type Job =
  operations["getApiJobsById"]["responses"][200]["content"]["application/json"];

export type JobKind = Job["kind"];

export type JobStatus = Job["status"];

export type Sharelink =
  operations["getApiShareByToken"]["responses"][200]["content"]["application/json"];

export type SharelinkTrack = Sharelink["tracks"][number];

/** One of the tracks a snapshot could freeze, with every version it could
 *  freeze it at. */
export type ShareOption =
  operations["getApiShareOptions"]["responses"][200]["content"]["application/json"][number];

export type ShareOptionAudio = ShareOption["audios"][number];

export type NewShareRequest =
  operations["postApiShareSnapshot"]["requestBody"]["content"]["application/json"];

export type EditSharelink =
  operations["patchApiShareByToken"]["requestBody"]["content"]["application/json"];

export type ConvertSharelinkRequest =
  operations["postApiShareByTokenConvert"]["requestBody"]["content"]["application/json"];

export type ShareCommentThread =
  operations["getApiShareByTokenComments"]["responses"][200]["content"]["application/json"][number];

export type NewShareComment =
  operations["postApiShareByTokenComments"]["requestBody"]["content"]["application/json"];

/** Public facts about the instance: what the sign-in card and the admin
 *  screen's About pane both read. */
export type Instance =
  operations["getApiInstance"]["responses"][200]["content"]["application/json"];

/** Every setting the caller receives, resolved by the server, and a version
 *  that changes whenever one of the values does. */
export type EffectiveSettingsRead =
  operations["getApiSettingsEffective"]["responses"][200]["content"]["application/json"];

/** The settings hub's view of every setting the caller receives: per key, the
 *  effective value and its source, the lock pinning it, where the caller may
 *  write it, and what each scope holds. */
export type SettingsHubRead =
  operations["getApiSettings"]["responses"][200]["content"]["application/json"];

/** The settings hub's view of the keys a settings write changed. */
export type WrittenSettings =
  operations["patchApiSettingsByScopeById"]["responses"][200]["content"]["application/json"];

/** The caller's own settings as a file: what an export gives and an import takes. */
export type SettingsExport =
  operations["getApiSettingsUserByIdExport"]["responses"][200]["content"]["application/json"];

/** The keys an import applied (or, as a dry run, would apply) and the ones it skipped, with why. */
export type SettingsImportReport =
  operations["postApiSettingsUserByIdImport"]["responses"][200]["content"]["application/json"];

/** Why an import skipped a key. */
export type SettingsImportSkipReason =
  SettingsImportReport["skipped"][number]["reason"];

/** One recorded change to a project's or the instance's settings: a value, a lock, or both. */
export type SettingsAuditEntry =
  operations["getApiSettingsAudit"]["responses"][200]["content"]["application/json"][number];

/** Locks to set (`true`) or lift (`false`) at a project or the instance. */
export type SettingsLocksPatch =
  operations["putApiSettingsByScopeByIdLocks"]["requestBody"]["content"]["application/json"];

export type InstanceUsersPage =
  operations["getApiAdminUsers"]["responses"][200]["content"]["application/json"];

/** An account as the instance admin's Users pane lists it. */
export type InstanceUser = InstanceUsersPage["rows"][number];

export type InstanceUserPatch =
  operations["patchApiAdminUsersById"]["requestBody"]["content"]["application/json"];

export type AdminResetLink =
  operations["postApiAdminUsersByIdResetLink"]["responses"][200]["content"]["application/json"];

export type AdminStorage =
  operations["getApiAdminStorage"]["responses"][200]["content"]["application/json"];

/** One project's or account's usage, as the admin storage pane lists it. */
export type StorageReport = AdminStorage["projects"][number];

/** A patch of settings at one scope: `{[key]: value}`, null clearing a key. */
export type SettingsPatch =
  operations["patchApiSettingsByScopeById"]["requestBody"]["content"]["application/json"];

/** The signed-in user's machines, and the "Not a bounce" files they share. */
export type MachineList =
  operations["getApiMachines"]["responses"][200]["content"]["application/json"];

/** One of the signed-in user's machines, as the machine list reads it. */
export type Machine = MachineList["machines"][number];

/** A file the signed-in user marked "Not a bounce", on every one of their machines. */
export type NotABounce = MachineList["notABounce"][number];

/** One page of every account's machines, as the instance admin's Machines pane lists them. */
export type InstanceMachinesPage =
  operations["getApiAdminMachines"]["responses"][200]["content"]["application/json"];

/** A machine with the account it belongs to, as the instance admin's Machines pane lists it. */
export type InstanceMachine = InstanceMachinesPage["items"][number];

/** What the app reports on each beat about its machine. */
export type MachineBeat =
  operations["putApiMachinesById"]["requestBody"]["content"]["application/json"];

/** A machine online on a session, as the session's presence lists it. */
export type MachinePresence =
  operations["getApiSessionsByIdPresence"]["responses"][200]["content"]["application/json"]["machines"][number];

export type { EntityKind, TableEntityKind } from "./entity";
