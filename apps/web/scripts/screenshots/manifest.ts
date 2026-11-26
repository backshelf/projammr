/**
 * Every product screenshot the marketing site and the docs use, as data:
 * where to go, who is looking, and what to do before the picture is taken.
 * `capture.ts` turns each entry into
 * `src/assets/screenshots/<id>.<theme>.<viewport>.webp`.
 *
 * Routes name seeded entities by their catalogue keys
 * (`packages/demo/src/catalogue.ts`) and `capture.ts` resolves them against
 * the seed's result file:
 *
 *   {project:low-tide}                 a project id
 *   {track:low-tide/ridgeline}         a track id (likewise collection:, session:)
 *   {lyrics:low-tide/soon-enough}      a track's lyrics note id
 *   {invite:glasshouse/juno@example.com}  a pending invite's token
 *   {note:0}                           the first notebook note's id
 *   {share:harbour-lights}             a share link's token
 *
 * A step is an `agent-browser` command, as its arguments, run in the shot's
 * browser session; `{ scroll }` brings an element into view inside the app's
 * scrolling canvas, and `{ pause }` waits a fixed number of milliseconds for
 * something no network or DOM condition marks as finished.
 */

export type Theme = "light" | "dark";
export type Viewport = "desktop" | "phone";

/**
 * `scroll` names a CSS selector, and `text` (optional) the start of the
 * matching element's text when the selector alone is not unique.
 */
export type Step =
  string[] | { scroll: string; text?: string } | { pause: number };

export interface Shot {
  id: string;
  /** What the shot is for, so a docs writer can find the right one. */
  shows: string;
  route: string;
  /**
   * Who is looking: a catalogue account key, signed in, or `guest`, signed
   * out. Defaults to the first account, the demo's producer.
   */
  as?: string;
  viewports?: Viewport[];
  themes?: Theme[];
  steps?: Step[];
}

const PROJECT = "/project/{project:low-tide}";
/** The hero track: three bounces, the newest at full bitrate. */
const RIDGELINE = `${PROJECT}/collection/{collection:low-tide/longshore-album}/track/{track:low-tide/ridgeline}`;
const SESSION = `${PROJECT}/session/{session:low-tide/halogen}`;

const click = (role: string, name: string) => [
  "find",
  "role",
  role,
  "click",
  "--name",
  name,
];
const hover = (role: string, name: string) => [
  "find",
  "role",
  role,
  "hover",
  "--name",
  name,
];
/** Clicks through whatever overlaps an element (the phone's sticky rail). */
const domClick = (label: string) => [
  "eval",
  `document.querySelector('[aria-label="${label}"]')?.click()`,
];
/** Starts a track; its waveform only carries comment pins while it is the player's track. */
const play = (title: string): Step[] => [
  click("button", `Play ${title}`),
  { pause: 1500 },
];

export const shots: Shot[] = [
  {
    id: "sign-in",
    shows: "The sign-in page",
    route: "/sign-in",
    as: "guest",
  },
  {
    id: "projects",
    shows: "The project list a member lands on",
    route: "/",
  },
  {
    id: "project",
    shows: "A project page: collections, the work heatmap, plugins and sharing",
    route: PROJECT,
  },
  {
    id: "collection",
    shows:
      "An EP's page: running order, loudness, spectrum and tempo across its tracks",
    route: `${PROJECT}/collection/{collection:low-tide/harbour-lights}`,
  },
  {
    id: "track",
    shows:
      "A track page playing: waveform with comment pins, versions, loudness and spectrum",
    route: RIDGELINE,
    steps: play("Ridgeline"),
  },
  {
    id: "track-comment-pin",
    shows: "Hovering a timecoded comment pin on the waveform",
    route: RIDGELINE,
    viewports: ["desktop"],
    steps: [
      ...play("Ridgeline"),
      click("button", "Pause Ridgeline"),
      hover("button", "Comment by Juno Adeyemi at 1:14"),
      { pause: 400 },
    ],
  },
  {
    id: "track-versions",
    shows: "The version picker on a track with three bounces",
    route: RIDGELINE,
    steps: [domClick("Choose a version"), { pause: 400 }],
  },
  {
    id: "track-lyrics",
    shows: "A track's lyrics, grouped by section with rhyme colouring",
    route: `${PROJECT}/collection/{collection:low-tide/harbour-lights}/track/{track:low-tide/lifeguard}`,
    viewports: ["desktop"],
    steps: [{ scroll: "[data-lyrics], .bn-container" }, { pause: 400 }],
  },
  {
    id: "session",
    shows:
      "A session page: set structure, plugins per track, samples, attachments and history",
    route: SESSION,
  },
  {
    id: "session-history",
    shows: "A session's save history with the save-to-save diff on every save",
    route: `${SESSION}/history`,
  },
  {
    id: "plugins",
    shows:
      "The plugin web of a project's sets and the devices they carry, with the device rows below",
    route: `${PROJECT}/plugins`,
    viewports: ["desktop"],
    // The web's renderer loads after the page settles, and draws on the frame after.
    steps: [["wait", ".sigma-mouse"], { pause: 400 }],
  },
  {
    id: "tracks-table",
    shows: "The tracks table",
    route: `${PROJECT}/track/all`,
  },
  {
    id: "tracks-table-views",
    shows: "The saved views menu on the tracks table",
    route: `${PROJECT}/track/all`,
    viewports: ["desktop"],
    steps: [click("button", "Views"), { pause: 400 }],
  },
  {
    id: "tracks-table-bulk",
    shows: "Selected rows and the bulk action bar",
    route: `${PROJECT}/track/all`,
    viewports: ["desktop"],
    steps: [
      ["find", "nth", "1", "[aria-label='Select row']", "click"],
      ["find", "nth", "2", "[aria-label='Select row']", "click"],
      ["find", "nth", "4", "[aria-label='Select row']", "click"],
      { pause: 400 },
    ],
  },
  {
    id: "collections-table",
    shows: "The collections table",
    route: `${PROJECT}/collection/all`,
    viewports: ["desktop"],
  },
  {
    id: "sessions-table",
    shows: "The sessions table",
    route: `${PROJECT}/session/all`,
    viewports: ["desktop"],
  },
  {
    id: "notebook",
    shows: "The notebook: the note list and an open note",
    route: "/notes/{note:0}",
  },
  {
    id: "lyrics-editor",
    shows: "The lyrics editor on a song's lyrics",
    route: "/notes/{lyrics:low-tide/soon-enough}",
    viewports: ["desktop"],
  },
  {
    id: "members",
    shows: "Project members, roles and a pending invite",
    route: "/settings/project/{project:low-tide}/members",
    viewports: ["desktop"],
  },
  {
    id: "statuses",
    shows: "A project's own statuses with their colours and percentages",
    route: "/settings/project/{project:low-tide}/statuses",
    viewports: ["desktop"],
  },
  {
    id: "share",
    shows: "The public share page of an EP, with a visitor's comment",
    route: "/share/{share:harbour-lights}",
    as: "guest",
  },
  {
    id: "player-queue",
    shows: "The player playing an album, with its queue open",
    route: `${PROJECT}/collection/{collection:low-tide/longshore-album}`,
    viewports: ["desktop"],
    steps: [...play("Longshore"), click("button", "Queue"), { pause: 400 }],
  },
  {
    id: "now-playing",
    shows: "The phone's now-playing sheet",
    route: RIDGELINE,
    viewports: ["phone"],
    steps: [
      ...play("Ridgeline"),
      click("button", "Now playing"),
      { pause: 800 },
    ],
  },
  {
    id: "command-palette",
    shows: "The command palette",
    route: PROJECT,
    viewports: ["desktop"],
    steps: [["press", "Control+k"], { pause: 400 }],
  },
  {
    id: "profile",
    shows: "A member's own profile",
    route: "/profile",
    viewports: ["desktop"],
  },
  {
    id: "admin-users",
    shows: "Instance settings: the accounts on the instance",
    route: "/settings/instance/users",
    viewports: ["desktop"],
  },
  {
    id: "admin-storage",
    shows: "Instance settings: storage by project and by user",
    route: "/settings/instance/storage",
    viewports: ["desktop"],
  },
  {
    id: "admin-registration",
    shows: "Instance settings: registration, closed after the first account",
    route: "/settings/instance/instance-access",
    viewports: ["desktop"],
  },
  {
    id: "admin-reset-link",
    shows: "Instance settings: a one-time password reset link for an account",
    route: "/settings/instance/users",
    viewports: ["desktop"],
    steps: [
      // The first row is the admin's own; the second is a collaborator's.
      [
        "eval",
        "[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Create reset link')[1]?.click()",
      ],
      { pause: 800 },
    ],
  },
  {
    id: "invite-accept",
    shows: "Joining a project from an invite link",
    route: "/invite/{invite:glasshouse/juno@example.com}",
    as: "juno",
    viewports: ["desktop"],
  },
  {
    id: "nav-project-switcher",
    shows: "The project switcher at the top of the sidebar",
    route: PROJECT,
    viewports: ["desktop"],
    steps: [click("button", "PROJECT Low Tide"), { pause: 400 }],
  },
  {
    id: "tables-board",
    shows: "The tracks table as a board, one column per status",
    route: `${PROJECT}/track/all?view=board`,
    viewports: ["desktop"],
  },
  {
    id: "track-compare",
    shows: "Comparing two versions of a track, A/B",
    route: RIDGELINE,
    viewports: ["desktop"],
    steps: [
      click("button", "Compare"),
      { pause: 400 },
      ["find", "role", "menuitem", "click", "--name", "v2 ridgeline"],
      { pause: 1500 },
    ],
  },
  {
    id: "player-lab",
    shows: "The Lab pane open on a playing track",
    route: RIDGELINE,
    viewports: ["desktop"],
    steps: [...play("Ridgeline"), ["press", "l"], { pause: 1000 }],
  },
  {
    id: "project-work-heatmap",
    shows: "A project's work heatmap of session saves",
    route: PROJECT,
    viewports: ["desktop"],
    steps: [{ scroll: "h2", text: "Work" }, { pause: 400 }],
  },
];
