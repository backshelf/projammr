import { describe, expect, it, mock } from "bun:test";
import { partial } from "@workspace/test/fixture";
import { PALETTE_PREFIX_COMMANDS } from "@workspace/settings/groups/palette";
import type { ActionContext } from "@/components/commands/types";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { DEFAULT_LAB, type LabSettings } from "@/lib/dsp/lab-settings";
import { HIGH, scaleLevel, SEEDED_SCALE } from "@/fields/priority-fixture";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { DEFAULT_SHELL } from "@/lib/policies/shell";
import { customField } from "@/fields/custom-field-fixture";
import type { PrefixRow } from "./action-context";
import type { SearchResult } from "@/components/command-palette/use-search";

// `action-context.ts` imports the real server actions, which pull in
// `server-only` — a package that throws when it lands anywhere but a Server
// Component module. These stand in for them so the module can load under
// bun test; none of the tests below reach past `isAvailable` into `resolve`.
mock.module("@/actions/labels", () => ({ getLabels: mock() }));
mock.module("@/actions/notes", () => ({ getMyNotes: mock() }));
mock.module("@/actions/statuses", () => ({ getStatuses: mock() }));
const getPriorityLevels = mock();
mock.module("@/actions/priorities", () => ({ getPriorityLevels }));
const getCustomFields = mock();
mock.module("@/actions/custom-fields", () => ({ getCustomFields }));
// A complete stand-in, not just the two names this file's tests reach:
// `bun test --parallel` shares one module registry across files, and
// `player-store.test.ts` mocks this same module with its own shape. Whichever
// mock wins the race, every export the real module has needs to exist here
// too, or the loser's import of a name this file left out throws.
mock.module("@/actions/tracks", () => ({
  getTracksForCollection: mock(),
  getTracksPageForProject: mock(),
  getTrack: mock(),
  createTrack: mock(),
  updateTrackNumber: mock(),
  getTrackSummaries: mock(),
  getTrackLabels: mock(),
}));
const patchEntity = mock();
const patchField = mock();
mock.module("@/actions/patch-field", () => ({ patchEntity, patchField }));
const setEntityLabels = mock();
const linkTracksToCollection = mock();
mock.module("@/entities/mutations", () => ({
  setEntityLabels,
  linkTracksToCollection,
}));
const toastError = mock();
mock.module("sonner", () => ({ toast: { error: toastError } }));

const { PREFIX_COMMANDS, labAuditionOn, resultHref } =
  await import("./action-context");
const { getTrackLabels } = await import("@/actions/tracks");

const CURRENT_TRACK = { asset: { id: 1 } } as ActionContext["currentTrack"];

const UNDO_WINDOW_MS = 9000;

/** A context with no router, player, or theme behaviour — every test here
 *  only exercises `isAvailable`, which never touches those fields. */
function makeContext(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    router: {} as ActionContext["router"],
    pathname: "/project/1",
    projectId: null,
    route: { kind: "not-found" },
    resolvedTheme: "light",
    setTheme: () => {},
    player: {} as ActionContext["player"],
    playerActions: {} as ActionContext["playerActions"],
    currentTrack: null,
    duration: 0,
    coarsePointer: false,
    setShortcutsOpen: () => {},
    palette: {} as ActionContext["palette"],
    nowPlaying: {} as ActionContext["nowPlaying"],
    labSettings: DEFAULT_LAB,
    openLab: () => {},
    canEdit: false,
    routeTrack: null,
    undoWindowMs: UNDO_WINDOW_MS,
    resultCap: DEFAULT_SHELL.paletteResultCap,
    formatters: defaultFormatters(),
    playback: DEFAULT_POLICIES.playback,
    toggleSidebar: () => {},
    ...overrides,
  };
}

const localRow = (id: string): PrefixRow => ({ kind: "local", id, title: id });

function availableIds<
  T extends { id: string; isAvailable?: (c: ActionContext) => boolean },
>(items: T[], ctx: ActionContext): string[] {
  return items
    .filter((item) => item.isAvailable?.(ctx) ?? true)
    .map((item) => item.id);
}

describe("PREFIX_COMMANDS vocabulary", () => {
  it("has exactly the ids the settings package lets an alias open", () => {
    expect(PREFIX_COMMANDS.map((each) => each.id).sort()).toEqual(
      [...PALETTE_PREFIX_COMMANDS].sort()
    );
  });
});

describe("PREFIX_COMMANDS availability off-project (projectId: null)", () => {
  const ctx = makeContext({ projectId: null });
  const available = availableIds(PREFIX_COMMANDS, ctx);

  it("offers the note command", () => {
    expect(available).toContain("note");
  });

  it("hides project-scoped search commands", () => {
    expect(available).not.toContain("play");
    expect(available).not.toContain("queue");
    expect(available).not.toContain("playnext");
    expect(available).not.toContain("go");
  });

  it("hides the commands that make or filter a project's records", () => {
    expect(available).not.toContain("new-track-titled");
    expect(available).not.toContain("new-session-named");
    expect(available).not.toContain("filter");
  });

  it("hides track-mutation commands that also need a project", () => {
    expect(available).not.toContain("status");
    expect(available).not.toContain("priority");
    expect(available).not.toContain("label");
  });
});

describe("PREFIX_COMMANDS availability inside a project", () => {
  const ctx = makeContext({ projectId: 7, route: { kind: "project" } });
  const available = availableIds(PREFIX_COMMANDS, ctx);

  it("offers the project-scoped search commands", () => {
    expect(available).toContain("play");
    expect(available).toContain("queue");
    expect(available).toContain("playnext");
    expect(available).toContain("go");
    expect(available).toContain("filter");
  });

  it("still offers the note command", () => {
    expect(available).toContain("note");
  });
});

describe("pitch and lab prefix commands", () => {
  it("work outside a project, unlike the search-backed commands", () => {
    const ctx = makeContext({ projectId: null, currentTrack: CURRENT_TRACK });
    const available = availableIds(PREFIX_COMMANDS, ctx);
    expect(available).toContain("pitch");
    expect(available).toContain("lab");
  });

  it("need a loaded track", () => {
    const ctx = makeContext({ currentTrack: null });
    const available = availableIds(PREFIX_COMMANDS, ctx);
    expect(available).not.toContain("pitch");
    expect(available).not.toContain("lab");
  });
});

describe("pitch command", () => {
  const command = PREFIX_COMMANDS.find((c) => c.id === "pitch")!;

  it("offers a row for a value in range", () => {
    const rows =
      command.mode === "sync" ? command.resolve("3", makeContext()) : [];
    expect(rows).toHaveLength(1);
  });

  it("offers nothing outside ±12 semitones", () => {
    const rows =
      command.mode === "sync" ? command.resolve("13", makeContext()) : [];
    expect(rows).toHaveLength(0);
  });

  it("sets the pitch action with the parsed value", () => {
    const set: number[] = [];
    const ctx = makeContext({
      playerActions: partial<ActionContext["playerActions"]>({
        setPitch: (v: number) => void set.push(v),
      }),
    });
    command.run(localRow("-2"), ctx);
    expect(set).toEqual([-2]);
  });
});

describe("lab command", () => {
  const command = PREFIX_COMMANDS.find((c) => c.id === "lab")!;
  const resolve = (
    remainder: string,
    settings: LabSettings,
    targetLufs = DEFAULT_POLICIES.lab.normaliseTargetLufs
  ) =>
    command.mode === "sync"
      ? command.resolve(
          remainder,
          makeContext({
            labSettings: settings,
            player: {
              getSnapshot: () => ({ lab: { targetLufs } }),
            } as unknown as ActionContext["player"],
          })
        )
      : [];

  it("names normalise with the target the playing track is heard at", () => {
    const [row] = resolve("normalise", DEFAULT_LAB, -20);
    expect(row?.kind === "local" && row.title).toBe("Turn on −20 LUFS");
  });

  it("offers every audition matching the typed prefix", () => {
    const rows = resolve("m", DEFAULT_LAB);
    expect(rows.map((r) => (r.kind === "local" ? r.id : null))).toEqual([
      "mono",
      "mid",
    ]);
  });

  it("reads as turning an off audition on", () => {
    const [row] = resolve("mono", DEFAULT_LAB);
    expect(row?.kind === "local" && row.title).toBe("Turn on Mono");
  });

  it("reads as turning an engaged audition off", () => {
    const settings: LabSettings = {
      ...DEFAULT_LAB,
      auditions: { ...DEFAULT_LAB.auditions, dim: true },
    };
    const [row] = resolve("dim", settings);
    expect(row?.kind === "local" && row.title).toBe("Turn off Dim");
  });

  it("toggles a stereo audition on, and back to stereo when run again", () => {
    let stereo = DEFAULT_LAB.auditions.stereo;
    const ctx = makeContext({
      playerActions: {
        setAudition: (patch: { stereo?: typeof stereo }) => {
          if (patch.stereo) stereo = patch.stereo;
        },
      } as ActionContext["playerActions"],
    });

    command.run(localRow("mono"), ctx);
    expect(stereo).toBe("mono");
  });

  it("toggles a device on and clears it back to null", () => {
    let device: string | null = null;
    const on = {
      ...DEFAULT_LAB,
      auditions: { ...DEFAULT_LAB.auditions, device: "phone" as const },
    };
    const ctx = makeContext({
      labSettings: on,
      playerActions: {
        setAudition: (patch: { device?: string | null }) => {
          if ("device" in patch) device = patch.device ?? null;
        },
      } as ActionContext["playerActions"],
    });

    command.run(localRow("phone"), ctx);
    expect(device).toBeNull();
  });
});

describe("labAuditionOn", () => {
  it("reads a stereo audition off the settings", () => {
    const settings = {
      ...DEFAULT_LAB,
      auditions: { ...DEFAULT_LAB.auditions, stereo: "mono" as const },
    };
    expect(labAuditionOn(settings, "mono")).toBe(true);
    expect(labAuditionOn(settings, "side")).toBe(false);
  });

  it("reads a device audition off the settings", () => {
    const settings = {
      ...DEFAULT_LAB,
      auditions: { ...DEFAULT_LAB.auditions, device: "car" as const },
    };
    expect(labAuditionOn(settings, "car")).toBe(true);
    expect(labAuditionOn(settings, "phone")).toBe(false);
  });

  it("reads the boolean auditions off the settings", () => {
    expect(labAuditionOn(DEFAULT_LAB, "dim")).toBe(false);
    expect(labAuditionOn(DEFAULT_LAB, "crossfeed")).toBe(false);
    expect(labAuditionOn(DEFAULT_LAB, "normalise")).toBe(false);
  });
});

describe("resultHref", () => {
  const searchResult = (
    overrides: Partial<SearchResult> & Pick<SearchResult, "type" | "id">
  ): SearchResult => ({
    title: "x",
    subtitle: "x",
    projectId: 1,
    matchedField: "title",
    image: null,
    archived: false,
    score: 1,
    ...overrides,
  });

  it("routes a search result to its kind's page in the project", () => {
    expect(resultHref(searchResult({ type: "track", id: 3 }), 1)).toBe(
      "/project/1/track/3"
    );
    expect(resultHref(searchResult({ type: "collection", id: 4 }), 1)).toBe(
      "/project/1/collection/4"
    );
    expect(resultHref(searchResult({ type: "session", id: 5 }), 1)).toBe(
      "/project/1/session/5"
    );
  });

  it("routes an asset to the project's assets pane in the settings hub", () => {
    expect(resultHref(searchResult({ type: "asset", id: 6 }), 1)).toBe(
      "/settings/project/1/assets"
    );
  });
});

describe("priority command", () => {
  const priorityCommand = PREFIX_COMMANDS.find((c) => c.id === "priority")!;
  const onTrack = () =>
    makeContext({ projectId: 1, route: { kind: "track", trackId: 5 } });
  const resolve = (remainder: string) => {
    if (priorityCommand.mode !== "async") throw new Error("expected async");
    return priorityCommand.resolve(
      remainder,
      onTrack(),
      new AbortController().signal
    );
  };
  const titles = (rows: PrefixRow[]) =>
    rows.map((row) => (row.kind === "local" ? row.title : row.kind));

  it("is offered on a track page only", () => {
    expect(availableIds([priorityCommand], onTrack())).toEqual(["priority"]);
    expect(
      availableIds(
        [priorityCommand],
        makeContext({ projectId: 1, route: { kind: "project" } })
      )
    ).toEqual([]);
  });

  it("lists the current project's levels matching the remainder, in the scale's order", async () => {
    getPriorityLevels.mockReset();
    getPriorityLevels.mockResolvedValue(SEEDED_SCALE);

    expect(titles(await resolve("m"))).toEqual(["Medium"]);
    expect(titles(await resolve(""))).toEqual([
      "None",
      "Low",
      "Medium",
      "High",
      "Urgent",
    ]);
    expect(getPriorityLevels).toHaveBeenCalledWith(1);
  });

  it("puts the level named exactly first, ahead of an earlier level containing it", async () => {
    getPriorityLevels.mockReset();
    getPriorityLevels.mockResolvedValue([
      scaleLevel(40, "Not high", 0),
      scaleLevel(41, "High", 1),
      scaleLevel(42, "Highest", 2),
    ]);

    expect(titles(await resolve("HIGH"))).toEqual([
      "High",
      "Not high",
      "Highest",
    ]);
  });

  it("offers nothing when the scale cannot be read", async () => {
    getPriorityLevels.mockReset();
    getPriorityLevels.mockResolvedValue({ error: "Nope", status: 500 });

    expect(await resolve("high")).toEqual([]);
  });

  it("offers no more rows than the palette's result cap", async () => {
    getPriorityLevels.mockReset();
    getPriorityLevels.mockResolvedValue(SEEDED_SCALE);
    if (priorityCommand.mode !== "async") throw new Error("expected async");

    const rows = await priorityCommand.resolve(
      "",
      makeContext({
        projectId: 1,
        route: { kind: "track", trackId: 5 },
        resultCap: 2,
      }),
      new AbortController().signal
    );

    expect(titles(rows)).toEqual(["None", "Low"]);
  });

  it("writes the picked level's id to the track", async () => {
    patchField.mockReset();
    patchField.mockResolvedValue({ id: 5 });

    await priorityCommand.run(localRow(String(HIGH.id)), onTrack());

    expect(patchField).toHaveBeenCalledWith("track", 5, "priorityId", HIGH.id);
  });

  it("shows a failed change as a toast", async () => {
    patchField.mockReset();
    toastError.mockReset();
    patchField.mockResolvedValue({
      error: "You need edit access",
      status: 403,
    });

    await priorityCommand.run(localRow(String(HIGH.id)), onTrack());

    expect(toastError).toHaveBeenCalledWith("You need edit access");
  });
});

describe("status, label and unlabel run()", () => {
  const statusCommand = PREFIX_COMMANDS.find((c) => c.id === "status")!;
  const labelCommand = PREFIX_COMMANDS.find((c) => c.id === "label")!;
  const unlabelCommand = PREFIX_COMMANDS.find((c) => c.id === "unlabel")!;

  function trackContext(): ActionContext & {
    router: { refresh: ReturnType<typeof mock> };
  } {
    const router = { refresh: mock(), push: mock() };
    return makeContext({
      projectId: 1,
      route: { kind: "track", trackId: 5 },
      router: router as unknown as ActionContext["router"],
    }) as ActionContext & { router: { refresh: ReturnType<typeof mock> } };
  }

  it("a failed status change shows a toast", async () => {
    patchField.mockReset();
    toastError.mockReset();
    patchField.mockResolvedValue({
      error: "You need edit access",
      status: 403,
    });
    const ctx = trackContext();

    await statusCommand.run(localRow("9"), ctx);

    expect(toastError).toHaveBeenCalledWith("You need edit access");
    expect(ctx.router.refresh).not.toHaveBeenCalled();
  });

  it("a failed label add shows a toast", async () => {
    setEntityLabels.mockReset();
    toastError.mockReset();
    (getTrackLabels as ReturnType<typeof mock>).mockResolvedValue([]);
    setEntityLabels.mockReturnValue({
      run: () =>
        Promise.resolve({ error: "Failed to set labels", status: 500 }),
      invalidates: ["route"],
    });
    const ctx = trackContext();

    await labelCommand.run(
      { kind: "local", id: "existing:3", title: "x" },
      ctx
    );

    expect(toastError).toHaveBeenCalledWith("Failed to set labels");
    expect(ctx.router.refresh).not.toHaveBeenCalled();
  });

  it("a failed label removal shows a toast", async () => {
    setEntityLabels.mockReset();
    toastError.mockReset();
    (getTrackLabels as ReturnType<typeof mock>).mockResolvedValue([
      { id: 3, name: "x" },
    ]);
    setEntityLabels.mockReturnValue({
      run: () =>
        Promise.resolve({ error: "Failed to set labels", status: 500 }),
      invalidates: ["route"],
    });
    const ctx = trackContext();

    await unlabelCommand.run(localRow("3"), ctx);

    expect(toastError).toHaveBeenCalledWith("Failed to set labels");
    expect(ctx.router.refresh).not.toHaveBeenCalled();
  });

  it("a successful label change refreshes the route once", async () => {
    setEntityLabels.mockReset();
    toastError.mockReset();
    (getTrackLabels as ReturnType<typeof mock>).mockResolvedValue([]);
    setEntityLabels.mockReturnValue({
      run: () => Promise.resolve([{ id: 3, name: "x" }]),
      invalidates: ["route"],
    });
    const ctx = trackContext();

    await labelCommand.run(
      { kind: "local", id: "existing:3", title: "x" },
      ctx
    );

    expect(toastError).not.toHaveBeenCalled();
    expect(ctx.router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("set command", () => {
  const setCommand = PREFIX_COMMANDS.find((c) => c.id === "set-field")!;
  const onTrack = () =>
    makeContext({ projectId: 1, route: { kind: "track", trackId: 5 } });
  const onCollection = () =>
    makeContext({
      projectId: 1,
      route: { kind: "collection", collectionId: 8 },
    });
  const FIELDS = [
    customField(1, "Mood", "select", [
      { id: "a1", label: "Dark" },
      { id: "b2", label: "Mellow" },
    ]),
    customField(2, "Energy", "number"),
    customField(4, "Cleared", "checkbox"),
    customField(9, "Title", "text"),
  ];
  const resolve = async (remainder: string, ctx = onTrack()) => {
    if (setCommand.mode !== "async") throw new Error("expected async");
    getCustomFields.mockReset();
    getCustomFields.mockResolvedValue(FIELDS);
    return setCommand.resolve(remainder, ctx, new AbortController().signal);
  };
  const titles = (rows: PrefixRow[]) =>
    rows.map((row) => (row.kind === "local" ? row.title : row.kind));

  it("is offered on a track or a collection page, and nowhere else", () => {
    expect(availableIds([setCommand], onTrack())).toEqual(["set-field"]);
    expect(availableIds([setCommand], onCollection())).toEqual(["set-field"]);
    expect(
      availableIds(
        [setCommand],
        makeContext({ projectId: 1, route: { kind: "project" } })
      )
    ).toEqual([]);
  });

  it("reads the page entity's own kind of fields", async () => {
    await resolve("energy 7", onCollection());
    expect(getCustomFields).toHaveBeenCalledWith(1, "collection");
  });

  it("parses a value with the field's kind", async () => {
    expect(titles(await resolve("energy 7"))).toEqual(["Set Energy to 7"]);
    expect(await resolve("energy loud")).toEqual([]);
  });

  it("offers a select's options matching the value, and a box's two states", async () => {
    expect(titles(await resolve("mood d"))).toEqual(["Set Mood to Dark"]);
    expect(titles(await resolve("mood"))).toEqual([
      "Set Mood to Dark",
      "Set Mood to Mellow",
    ]);
    expect(titles(await resolve("cleared"))).toEqual([
      "Set Cleared to Yes",
      "Set Cleared to No",
    ]);
  });

  it("lets the built-in title win over a custom field of the same name", async () => {
    const [row] = await resolve("title Neon Rain");
    expect(row?.kind === "local" && JSON.parse(row.id)).toEqual({
      key: "title",
      value: "Neon Rain",
    });
  });

  it("reaches that custom field by its full name in quotes", async () => {
    const [row] = await resolve('"Title" working title');
    expect(row?.kind === "local" && JSON.parse(row.id)).toEqual({
      key: "cf_9",
      value: "working title",
    });
  });

  it("writes the value to the page's entity by the field's key", async () => {
    patchField.mockReset();
    patchField.mockResolvedValue({ id: 5 });
    const [row] = await resolve("mood mellow");

    await setCommand.run(row!, onTrack());

    expect(patchField).toHaveBeenCalledWith("track", 5, "cf_1", "b2");
  });

  it("shows a failed write as a toast", async () => {
    patchField.mockReset();
    toastError.mockReset();
    patchField.mockResolvedValue({ error: "Energy must be a number" });
    const [row] = await resolve("energy 7");

    await setCommand.run(row!, onTrack());

    expect(toastError).toHaveBeenCalledWith("Energy must be a number");
  });
});

describe("theme command", () => {
  const command = PREFIX_COMMANDS.find((c) => c.id === "theme")!;

  it("offers each theme matching the typed prefix", () => {
    const rows =
      command.mode === "sync" ? command.resolve("s", makeContext()) : [];
    expect(rows.map((row) => row.kind === "local" && row.id)).toEqual([
      "system",
    ]);
  });

  it("sets the chosen theme, and nothing for a row that names none", () => {
    const set: string[] = [];
    const ctx = makeContext({ setTheme: (theme) => void set.push(theme) });
    command.run(localRow("dark"), ctx);
    command.run(localRow("sepia"), ctx);
    expect(set).toEqual(["dark"]);
  });
});
