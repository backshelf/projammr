import { describe, expect, it } from "bun:test";
import {
  editCollectionSchema,
  newCollectionSchema,
} from "./schema/collections.js";
import * as enums from "./schema/enums.js";
import { editProjectSchema, newProjectSchema } from "./schema/projects.js";
import {
  dawCapabilitiesSchema,
  editSessionSchema,
  newSessionSchema,
  normaliseRootNote,
  normaliseScale,
  sessionStructureSchema,
} from "./schema/sessions.js";
import { editStatusSchema, newStatusSchema } from "./schema/statuses.js";
import {
  editTrackSchema,
  newTrackSchema,
  trackSchema,
} from "./schema/tracks.js";

describe("insert and update schemas", () => {
  it("drops a client-supplied id and the database's timestamps", () => {
    const parsed = newTrackSchema.parse({
      id: 5,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      title: "Low Tide",
      artists: ["Nel"],
      projectId: 1,
    });

    expect(parsed).toEqual({
      title: "Low Tide",
      artists: ["Nel"],
      projectId: 1,
    });
  });

  it("drops them for every entity, not just the one", () => {
    expect(
      newCollectionSchema.parse({
        id: 5,
        createdAt: "2026-01-01T00:00:00.000Z",
        title: "Up All Night",
        projectId: 1,
      })
    ).toEqual({ title: "Up All Night", projectId: 1 });
  });

  it("keeps a status in the project it was created for", () => {
    expect(newStatusSchema.shape).toHaveProperty("projectId");
    expect(editStatusSchema.shape).not.toHaveProperty("projectId");
  });

  // A create names the project; an edit cannot rename it. Moving a row would
  // carry it past a gate that only ever checked where it came from.
  it("names the project on a create and refuses to move it on an edit", () => {
    for (const schema of [
      newTrackSchema,
      newCollectionSchema,
      newSessionSchema,
    ]) {
      expect(schema.shape).toHaveProperty("projectId");
    }

    for (const schema of [
      editTrackSchema,
      editCollectionSchema,
      editSessionSchema,
    ]) {
      expect(schema.shape).not.toHaveProperty("projectId");
    }

    expect(
      newTrackSchema.safeParse({ title: "Homeless", artists: [] }).success
    ).toBe(false);
  });

  it("takes the local-file timestamps as an epoch in milliseconds", () => {
    const at = Date.UTC(2026, 0, 1);
    const parsed = newSessionSchema.parse({
      name: "low-tide.als",
      daw: "ableton",
      projectId: 1,
      localFileCreatedAt: at,
    });

    expect(parsed.localFileCreatedAt).toEqual(new Date(at));
  });

  // Only the archive routes write `archivedAt`: a create or a PATCH carrying it
  // is ignored like any other column the write schemas leave out.
  it("leaves a track's archived timestamp out of create and edit", () => {
    const archivedAt = "2026-01-01T00:00:00.000Z";

    expect(newTrackSchema.shape).not.toHaveProperty("archivedAt");
    expect(editTrackSchema.shape).not.toHaveProperty("archivedAt");
    expect(
      newTrackSchema.parse({ title: "Low Tide", projectId: 1, archivedAt })
    ).not.toHaveProperty("archivedAt");
    expect(editTrackSchema.parse({ archivedAt })).toEqual({});
  });

  // Cover images are written only through `/images/parent/*` and MCP's cover
  // tools so every cover backs onto a stored `images` row with a palette.
  it("leaves image out of project, collection and track create and edit schemas", () => {
    const externalUrl = "https://example.com/cover.jpg";

    for (const schema of [
      newProjectSchema,
      editProjectSchema,
      newCollectionSchema,
      editCollectionSchema,
      newTrackSchema,
      editTrackSchema,
    ]) {
      expect(schema.shape).not.toHaveProperty("image");
    }

    expect(
      newProjectSchema.parse({ name: "Tidal", links: [], image: externalUrl })
    ).not.toHaveProperty("image");
    expect(
      newCollectionSchema.parse({
        title: "Stuck",
        projectId: 1,
        image: externalUrl,
      })
    ).not.toHaveProperty("image");
    expect(
      newTrackSchema.parse({
        title: "Worth",
        projectId: 1,
        image: externalUrl,
      })
    ).not.toHaveProperty("image");
    expect(editProjectSchema.parse({ image: externalUrl })).toEqual({});
    expect(editCollectionSchema.parse({ image: externalUrl })).toEqual({});
    expect(editTrackSchema.parse({ image: externalUrl })).toEqual({});
  });

  it("reads a track row archived or live", () => {
    const row = {
      id: 1,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
      updatedAt: new Date(Date.UTC(2026, 0, 2)),
      title: "Low Tide",
      artists: ["Nel"],
      priorityId: 1,
      statusId: 1,
      projectId: 1,
      notes: null,
      notesText: null,
      image: null,
      releaseDate: null,
      isrc: null,
      iswc: null,
      explicit: false,
    };
    const archivedAt = new Date(Date.UTC(2026, 0, 3));

    expect(trackSchema.parse({ ...row, archivedAt }).archivedAt).toEqual(
      archivedAt
    );
    expect(trackSchema.parse({ ...row, archivedAt: null }).archivedAt).toBe(
      null
    );
  });
});

describe("the musical key normalisers", () => {
  it("spells a root note with a sharp, whatever the input's accidental or case", () => {
    expect(normaliseRootNote("a♯")).toBe("A#");
    expect(normaliseRootNote("Bb")).toBe("A#");
    expect(normaliseRootNote("db")).toBe("C#");
    expect(normaliseRootNote(" c ")).toBe("C");
  });

  it("crosses a letter for the accidentals with no black key of their own", () => {
    expect(normaliseRootNote("Cb")).toBe("B");
    expect(normaliseRootNote("B#")).toBe("C");
    expect(normaliseRootNote("Fb")).toBe("E");
    expect(normaliseRootNote("E#")).toBe("F");
  });

  it("refuses a string that names none of the twelve pitches", () => {
    expect(normaliseRootNote("H")).toBeNull();
    expect(normaliseRootNote("")).toBeNull();
    expect(normaliseRootNote("C minor")).toBeNull();
  });

  it("pins major and minor to one capitalisation and leaves other modes alone", () => {
    expect(normaliseScale("major")).toBe("Major");
    expect(normaliseScale("MINOR")).toBe("Minor");
    expect(normaliseScale("Dorian")).toBe("Dorian");
    expect(normaliseScale("Harmonic Minor")).toBe("Harmonic Minor");
    expect(normaliseScale("  Major  ")).toBe("Major");
  });

  it("reads a blank scale as no scale at all", () => {
    expect(normaliseScale("")).toBeNull();
    expect(normaliseScale("   ")).toBeNull();
  });

  it("normalises the key a write carries, on a create and on an edit alike", () => {
    expect(
      newSessionSchema.parse({
        name: "low-tide.als",
        daw: "ableton",
        projectId: 1,
        rootNote: "a♯",
        scale: "major",
      })
    ).toMatchObject({ rootNote: "A#", scale: "Major" });

    expect(editSessionSchema.parse({ rootNote: "Bb", scale: "" })).toEqual({
      rootNote: "A#",
      scale: null,
    });
  });

  it("rejects a write whose root note is not a note", () => {
    expect(editSessionSchema.safeParse({ rootNote: "X" }).success).toBe(false);
    expect(editSessionSchema.safeParse({ rootNote: null }).success).toBe(true);
  });
});

describe("document columns", () => {
  it("accepts a BlockNote document as an array of blocks", () => {
    const notes = [{ type: "paragraph", content: [] }];

    expect(
      newTrackSchema.parse({ title: "Low Tide", projectId: 1, notes }).notes
    ).toEqual(notes);
    expect(editSessionSchema.parse({ notes }).notes).toEqual(notes);
  });

  it("rejects a document that is not an array of blocks", () => {
    expect(
      newTrackSchema.safeParse({ title: "Low Tide", projectId: 1, notes: "hi" })
        .success
    ).toBe(false);
  });
});

describe("the daw column", () => {
  it("accepts a lowercase module id and refuses the old enum's mixed-case spellings", () => {
    expect(
      newSessionSchema.safeParse({
        name: "low-tide.als",
        daw: "ableton",
        projectId: 1,
      }).success
    ).toBe(true);

    expect(
      newSessionSchema.safeParse({
        name: "low-tide.als",
        daw: "Ableton",
        projectId: 1,
      }).success
    ).toBe(false);
  });

  it("drops a capability the server does not know, so a newer scanner does not fail against it", () => {
    expect(
      dawCapabilitiesSchema.parse(["tempo", "a-future-capability", "structure"])
    ).toEqual(["tempo", "structure"]);
  });
});

describe("a session's structure", () => {
  it('keeps a track kind it does not recognise as "other" rather than refusing it', () => {
    const structure = sessionStructureSchema.parse({
      tracks: [{ kind: "folder", name: "Verse", devices: [] }],
    });

    expect(structure.tracks[0]?.kind).toBe("other");
  });

  it("stores without clips or scenes, for a DAW that cannot report either", () => {
    const structure = sessionStructureSchema.parse({
      tracks: [{ kind: "audio", name: "Vocals", devices: [] }],
    });

    expect(structure.clips).toBeUndefined();
    expect(structure.scenes).toBeUndefined();
  });

  it("keeps a track's colour, and drops one that is not a colour rather than refusing the save", () => {
    const structure = sessionStructureSchema.parse({
      tracks: [
        { kind: "audio", name: "Kick", devices: [], color: "#ff3636" },
        { kind: "audio", name: "Snare", devices: [], color: "red" },
        { kind: "audio", name: "Hat", devices: [] },
      ],
    });

    expect(structure.tracks.map((track) => track.color)).toEqual([
      "#ff3636",
      undefined,
      undefined,
    ]);
  });

  it("stores a plugin in any format a DAW hosts, not only Live's three", () => {
    const plugins = {
      Surge: { host: "clap", manufacturer: "Surge Synth Team" },
      "Pro-Q 4": { host: "aax" },
    };

    expect(
      sessionStructureSchema.parse({
        tracks: [{ kind: "midi", name: "Lead", devices: ["Surge"] }],
        plugins,
      }).plugins
    ).toEqual(plugins);
    expect(
      sessionStructureSchema.safeParse({
        tracks: [],
        plugins: { Surge: { host: "CLAP Plugin" } },
      }).success
    ).toBe(false);
  });
});

describe("the Postgres enums", () => {
  // A pgEnum is callable — `dawEnum("daw")` builds the column — so it is a
  // function carrying the values, not a plain object.
  const isPgEnum = (v: unknown): v is { enumValues: readonly string[] } =>
    typeof v === "function" && "enumValues" in v;

  // A list rather than a set: two enums can legitimately carry the same values
  // — an image's scope and a storage counter's are both project-or-user — and
  // each still has to have a raw array of its own.
  const rawValues = Object.values(enums)
    .filter(Array.isArray)
    .map((raw) => JSON.stringify(raw));

  // Postgres enum ordering is part of the type, so a raw array that has
  // drifted in order is as wrong as one that has drifted in membership.
  it("take their values, in order, from an exported raw array", () => {
    const pgEnums = Object.entries(enums).filter(([, v]) => isPgEnum(v));
    expect(pgEnums.length).toEqual(rawValues.length);

    const orphans = pgEnums
      .filter(
        ([, value]) =>
          !isPgEnum(value) ||
          !rawValues.includes(JSON.stringify(value.enumValues))
      )
      .map(([name]) => name);

    expect(orphans).toEqual([]);
  });

  it("record archiving, unarchiving, resolving and reopening as activity actions of their own", () => {
    expect(enums.activityActionEnum.enumValues).toEqual([
      "created",
      "updated",
      "deleted",
      "commented",
      "archived",
      "unarchived",
      "resolved",
      "reopened",
    ]);
  });
});

describe("project links", () => {
  it("requires a name and a URL on every link", () => {
    expect(
      newProjectSchema.safeParse({
        name: "Tidal",
        links: [{ name: "bandcamp", url: "not a url" }],
      }).success
    ).toBe(false);
  });
});
