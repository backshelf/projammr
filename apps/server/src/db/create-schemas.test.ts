import { describe, expect, it } from "bun:test";
import {
  editCollectionSchema,
  newCollectionSchema,
} from "./schema/collections.js";
import { editProjectSchema, newProjectSchema } from "./schema/projects.js";
import { editSessionSchema, newSessionSchema } from "./schema/sessions.js";
import { editTrackSchema, newTrackSchema } from "./schema/tracks.js";

describe("a blank title or name", () => {
  it("is refused on a track create and trimmed to nothing on a track edit", () => {
    expect(
      newTrackSchema.safeParse({ title: "", artists: [], projectId: 1 }).success
    ).toBe(false);
    expect(
      newTrackSchema.safeParse({ title: "   ", artists: [], projectId: 1 })
        .success
    ).toBe(false);
    expect(editTrackSchema.safeParse({ title: "  " }).success).toBe(false);
  });

  it("is refused on a collection create and edit", () => {
    expect(
      newCollectionSchema.safeParse({ title: "", projectId: 1 }).success
    ).toBe(false);
    expect(editCollectionSchema.safeParse({ title: "   " }).success).toBe(
      false
    );
  });

  it("is refused on a session create and edit", () => {
    expect(
      newSessionSchema.safeParse({
        name: "",
        daw: "ableton",
        projectId: 1,
      }).success
    ).toBe(false);
    expect(editSessionSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("is refused on a project create and edit", () => {
    expect(newProjectSchema.safeParse({ name: "", links: [] }).success).toBe(
      false
    );
    expect(editProjectSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("is trimmed, not just accepted, on a valid title or name", () => {
    expect(
      newTrackSchema.parse({
        title: "  Low Tide  ",
        artists: [],
        projectId: 1,
      }).title
    ).toBe("Low Tide");
    expect(newProjectSchema.parse({ name: "  Tidal  ", links: [] }).name).toBe(
      "Tidal"
    );
  });
});

describe("a collection's release date", () => {
  it("refuses a string that isn't shaped like a date", () => {
    expect(
      newCollectionSchema.safeParse({
        title: "Up All Night",
        projectId: 1,
        releaseDate: "banana",
      }).success
    ).toBe(false);
  });

  it("refuses a shape-valid date that doesn't exist on the calendar", () => {
    expect(
      newCollectionSchema.safeParse({
        title: "Up All Night",
        projectId: 1,
        releaseDate: "2026-02-30",
      }).success
    ).toBe(false);
    expect(
      editCollectionSchema.safeParse({ releaseDate: "2026-13-01" }).success
    ).toBe(false);
  });

  it("accepts a real calendar date and keeps it a string, not a Date", () => {
    const parsed = newCollectionSchema.parse({
      title: "Up All Night",
      projectId: 1,
      releaseDate: "2026-02-28",
    });

    expect(parsed.releaseDate).toBe("2026-02-28");
    expect(typeof parsed.releaseDate).toBe("string");
  });

  it("stays nullable, unset on writes only", () => {
    expect(
      newCollectionSchema.safeParse({
        title: "Up All Night",
        projectId: 1,
        releaseDate: null,
      }).success
    ).toBe(true);
    expect(
      newCollectionSchema.safeParse({ title: "Up All Night", projectId: 1 })
        .success
    ).toBe(true);
  });
});

describe("a track's release date", () => {
  it("validates YYYY-MM-DD real calendar dates and keeps them strings", () => {
    expect(
      newTrackSchema.safeParse({
        title: "Single",
        projectId: 1,
        releaseDate: "2026-02-30",
      }).success
    ).toBe(false);
    expect(
      editTrackSchema.safeParse({ releaseDate: "not-a-date" }).success
    ).toBe(false);
    const parsed = newTrackSchema.parse({
      title: "Single",
      projectId: 1,
      releaseDate: "2026-07-15",
    });
    expect(parsed.releaseDate).toBe("2026-07-15");
    expect(editTrackSchema.parse({ releaseDate: null }).releaseDate).toBeNull();
  });
});
