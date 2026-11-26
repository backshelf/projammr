import { describe, expect, it } from "bun:test";
import { DEFAULT_SHELL } from "@/lib/policies/shell";
import {
  orderCollections,
  recentNotes,
  recentSessions,
  recentTracks,
} from "./sidebar-lists";

const track = (id: number, archived = false) => ({
  id,
  archivedAt: archived ? "2026-09-01T00:00:00.000Z" : null,
});

const tracks = [
  track(1),
  track(2, true),
  track(3),
  track(4),
  track(5),
  track(6),
  track(7),
];

describe("recentTracks", () => {
  it("lists the newest five live tracks, an archived one never taking a place", () => {
    expect(recentTracks(tracks, DEFAULT_SHELL).map((t) => t.id)).toEqual([
      1, 3, 4, 5, 6,
    ]);
  });

  it("keeps archived tracks when the policy does not skip them", () => {
    expect(
      recentTracks(tracks, {
        recentItems: 3,
        recentsSkipArchived: false,
      }).map((t) => t.id)
    ).toEqual([1, 2, 3]);
  });

  it("lists nothing for a count of zero", () => {
    expect(recentTracks(tracks, { ...DEFAULT_SHELL, recentItems: 0 })).toEqual(
      []
    );
  });
});

describe("recentSessions", () => {
  const sessions = [
    { id: 1, archived: true },
    { id: 2, archived: false },
    { id: 3, archived: false },
  ];

  it("skips the sessions of archived tracks by default", () => {
    expect(recentSessions(sessions, DEFAULT_SHELL).map((s) => s.id)).toEqual([
      2, 3,
    ]);
  });

  it("keeps them, and takes the policy's count, when told to", () => {
    expect(
      recentSessions(sessions, {
        recentItems: 2,
        recentsSkipArchived: false,
      }).map((s) => s.id)
    ).toEqual([1, 2]);
  });
});

describe("recentNotes", () => {
  it("lists the newest notes by their last edit, pinned or not", () => {
    const notes = [
      { id: 1, updatedAt: "2026-09-01T00:00:00.000Z" },
      { id: 2, updatedAt: "2026-09-03T00:00:00.000Z" },
      { id: 3, updatedAt: "2026-09-02T00:00:00.000Z" },
    ];

    expect(
      recentNotes(notes, { ...DEFAULT_SHELL, recentItems: 2 }).map((n) => n.id)
    ).toEqual([2, 3]);
  });
});

describe("orderCollections", () => {
  const collections = [
    { title: "B", releaseDate: null, updatedAt: "2026-09-03T00:00:00.000Z" },
    {
      title: "C",
      releaseDate: "2026-01-01",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
    { title: "A", releaseDate: null, updatedAt: "2026-09-02T00:00:00.000Z" },
    {
      title: "D",
      releaseDate: "2026-06-01",
      updatedAt: "2026-08-01T00:00:00.000Z",
    },
  ];
  const titles = (order: Parameters<typeof orderCollections>[1]) =>
    orderCollections(collections, order).map((c) => c.title);

  it("puts the newest release first and undated ones after, by title, by default", () => {
    expect(titles(DEFAULT_SHELL.sidebarCollectionOrder)).toEqual([
      "D",
      "C",
      "A",
      "B",
    ]);
  });

  it("orders by title", () => {
    expect(titles("title")).toEqual(["A", "B", "C", "D"]);
  });

  it("orders by the most recent edit", () => {
    expect(titles("edited")).toEqual(["B", "A", "C", "D"]);
  });

  it("leaves the list it was given as it was", () => {
    const given = [...collections];
    orderCollections(given, "title");
    expect(given).toEqual(collections);
  });
});
