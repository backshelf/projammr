import { describe, expect, it } from "bun:test";
import {
  DEFAULT_LAB,
  EQ_BANDS,
  PITCH_MAX,
  PITCH_MIN,
  SPEED_MAX,
  SPEED_MIN,
} from "@/lib/dsp/lab-settings";
import {
  feedbackFrom,
  formatPrefsFrom,
  labFrom,
  policiesFrom,
  shellFrom,
  visualsFrom,
} from "@/lib/policies/from-settings";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { DEFAULT_SETTINGS } from "@/lib/settings/effective";
import { SETTINGS, type SettingsValues } from "@workspace/settings";
import { RACK_DEFAULT } from "@workspace/settings/groups/lab";
import { DEFAULT_FORMAT_PREFS } from "@workspace/ui/lib/formatters";

/** The registry's defaults with `changes` stored over them. */
const stored = (changes: Partial<SettingsValues>): SettingsValues => ({
  ...DEFAULT_SETTINGS,
  ...changes,
});

describe("the mappings over the registry's defaults", () => {
  it("build every policy at its defaults", () => {
    expect(policiesFrom(DEFAULT_SETTINGS)).toEqual(DEFAULT_POLICIES);
  });

  it("build the format preferences at their defaults", () => {
    expect(formatPrefsFrom(DEFAULT_SETTINGS)).toEqual(DEFAULT_FORMAT_PREFS);
  });
});

describe("durations", () => {
  it("turn the seconds a setting holds into the milliseconds a policy reads", () => {
    const values = stored({
      "feedback.toastDuration": 6,
      "feedback.undoWindow": 10,
      "lab.releaseDelay": 0,
    });

    expect(feedbackFrom(values).toastDurationMs).toBe(6000);
    expect(feedbackFrom(values).undoWindowMs).toBe(10_000);
    expect(labFrom(values).releaseDelayMs).toBe(0);
  });
});

describe("the Lab's ranges", () => {
  it("take the Lab's whole range when the setting holds the rack default", () => {
    const lab = labFrom(
      stored({ "lab.speedRange": RACK_DEFAULT, "lab.pitchRange": RACK_DEFAULT })
    );

    expect(lab.speedRange).toEqual({ min: SPEED_MIN, max: SPEED_MAX });
    expect(lab.pitchRange).toEqual({ min: PITCH_MIN, max: PITCH_MAX });
  });

  it("keep a range inside the Lab's bounds, stopping an end that passes them", () => {
    const lab = labFrom(
      stored({
        "lab.speedRange": { min: 0.75, max: 1.25 },
        "lab.pitchRange": { min: PITCH_MIN - 12, max: 5 },
      })
    );

    expect(lab.speedRange).toEqual({ min: 0.75, max: 1.25 });
    expect(lab.pitchRange).toEqual({ min: PITCH_MIN, max: 5 });
  });
});

describe("the Lab's rack", () => {
  it("starts from the rack's own parts where the setting holds the rack default", () => {
    const lab = labFrom(
      stored({
        "lab.compressor": RACK_DEFAULT,
        "lab.reverb": RACK_DEFAULT,
        "lab.eqPreset": RACK_DEFAULT,
      })
    );

    expect(lab.compressor).toEqual(DEFAULT_LAB.rack.comp);
    expect(lab.reverb).toEqual(DEFAULT_LAB.rack.reverb);
    expect(lab.eqPreset).toEqual(DEFAULT_LAB.rack.eq);
  });

  it("starts from the parts the setting holds", () => {
    const comp = { ...DEFAULT_LAB.rack.comp, on: true, ratio: 8 };
    const reverb = { ...DEFAULT_LAB.rack.reverb, on: true, preset: "hall" };
    const bands = DEFAULT_LAB.rack.eq.bands.map((band, i) =>
      i === 0 ? { ...band, kind: "lowShelf", gainDb: 3 } : band
    );
    const lab = labFrom(
      stored({
        "lab.compressor": comp,
        "lab.reverb": reverb,
        "lab.eqPreset": { on: true, bands },
      })
    );

    expect(lab.compressor).toEqual(comp);
    expect(lab.reverb).toEqual({ ...reverb, preset: "hall" });
    expect(lab.eqPreset).toEqual({ on: true, bands } as typeof lab.eqPreset);
  });

  it("falls back to the rack's own reverb for a preset the chain does not know", () => {
    const lab = labFrom(
      stored({
        "lab.reverb": { ...DEFAULT_LAB.rack.reverb, on: true, preset: "cave" },
      })
    );

    expect(lab.reverb).toEqual(DEFAULT_LAB.rack.reverb);
  });

  it("falls back to the rack's own EQ for a filter the chain does not know, or a band too many", () => {
    const unknown = DEFAULT_LAB.rack.eq.bands.map((band, i) =>
      i === 3 ? { ...band, kind: "notch" } : band
    );
    const extra = [...DEFAULT_LAB.rack.eq.bands, DEFAULT_LAB.rack.eq.bands[0]!];

    expect(extra).toHaveLength(EQ_BANDS + 1);
    for (const bands of [unknown, extra]) {
      expect(
        labFrom(stored({ "lab.eqPreset": { on: true, bands } })).eqPreset
      ).toEqual(DEFAULT_LAB.rack.eq);
    }
  });
});

describe("the strips", () => {
  it("drop an id no strip answers to any more", () => {
    expect(
      visualsFrom(stored({ "visuals.strips": ["change", "sections"] })).strips
    ).toEqual(["change"]);
  });
});

describe("the delete confirmations", () => {
  it("ask for a kind the setting leaves out, and not for one it turns off", () => {
    const { confirmDeletes } = feedbackFrom(
      stored({ "feedback.confirmDeletes": { track: false } })
    );

    expect(confirmDeletes.track).toBe(false);
    expect(confirmDeletes.project).toBe(true);
    expect(confirmDeletes.collection).toBe(true);
  });
});

describe("the week start", () => {
  it("names the day the formatters count from", () => {
    const day = (weekStart: SettingsValues["formats.weekStart"]) =>
      formatPrefsFrom(stored({ "formats.weekStart": weekStart })).weekStart;

    expect([day("sunday"), day("monday"), day("saturday")]).toEqual([0, 1, 6]);
  });
});

describe("the command bar", () => {
  it("hands the shell the three bar settings", () => {
    const { commandBar } = shellFrom(
      stored({
        "commands.barEnabled": true,
        "commands.barPosition": "top",
        "commands.barMode": "pending",
      })
    );

    expect(commandBar).toEqual({
      enabled: true,
      position: "top",
      mode: "pending",
    });
  });
});

describe("the arranged lists", () => {
  it("hand the dock and the palette the ids they show, in order", () => {
    const shell = shellFrom(
      stored({
        "layout.dockTabs": [
          { id: "notes", shown: true },
          { id: "collections", shown: false },
          { id: "tracks", shown: true },
          { id: "sessions", shown: false },
          { id: "search", shown: false },
        ],
        "palette.emptyGroups": [
          { id: "recent-sessions", shown: true },
          { id: "actions", shown: true },
          { id: "recent-tracks", shown: false },
        ],
      })
    );

    expect(shell.dockTabs).toEqual(["notes", "tracks"]);
    expect(shell.paletteEmptyGroups).toEqual(["recent-sessions", "actions"]);
  });

  it("show the dock and palette ids a stored list leaves out, after the stored ones", () => {
    const shell = shellFrom(
      stored({
        "layout.dockTabs": [{ id: "notes", shown: true }],
        "palette.emptyGroups": [{ id: "recent-sessions", shown: false }],
      })
    );

    expect(shell.dockTabs).toEqual([
      "notes",
      "collections",
      "tracks",
      "sessions",
      "search",
    ]);
    expect(shell.paletteEmptyGroups).toEqual(["actions", "recent-tracks"]);
  });

  it("lists the repositories section on the track and collection pages, after sessions and tracks", () => {
    const shell = shellFrom(stored({}));
    const ids = (sections: readonly { id: string }[]) =>
      sections.map(({ id }) => id);

    const track = ids(shell.entityPageSections.track);
    expect(track.indexOf("repositories")).toBe(track.indexOf("sessions") + 1);
    const collection = ids(shell.entityPageSections.collection);
    expect(collection.indexOf("repositories")).toBe(
      collection.indexOf("tracks") + 1
    );
  });

  it("appends the repositories section to a track arrangement stored before it existed", () => {
    const shell = shellFrom(
      stored({
        "pages.trackSections": [
          { id: "sessions", shown: true },
          { id: "overview", shown: true },
        ],
      })
    );

    const ids = shell.entityPageSections.track.map(({ id }) => id);
    expect(ids.slice(0, 2)).toEqual(["sessions", "overview"]);
    expect(ids).toContain("repositories");
  });

  it("show an id a stored list leaves out, after the stored rows, with the default's row", () => {
    const shell = shellFrom(
      stored({
        "layout.sidebarSections": [
          { id: "tracks", shown: false, collapsed: true },
        ],
      })
    );

    expect(shell.sidebarSections).toEqual([
      { id: "tracks", shown: false, collapsed: true },
      ...SETTINGS["layout.sidebarSections"].default.filter(
        ({ id }) => id !== "tracks"
      ),
    ]);
  });
});
