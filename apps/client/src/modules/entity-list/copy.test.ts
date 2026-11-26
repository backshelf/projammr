import { describe, expect, it } from "bun:test";

import { session } from "@/entities/session";
import { track } from "@/entities/track";
import { archivedListCopy, listCopy } from "./copy";

const config = { ledeOpening: "Every DAW session in" };

describe("listCopy", () => {
  it("names the page and its button from the kind's nouns", () => {
    expect(listCopy(session, config, "Demo")).toMatchObject({
      title: "All sessions",
      crumb: "All sessions",
      newLabel: "New session",
    });
  });

  it("opens the lede with the config's words and the project's name", () => {
    expect(listCopy(session, config, "Demo").lede).toBe(
      "Every DAW session in Demo."
    );
  });

  it("appends the count to the lede once it is known", () => {
    expect(listCopy(session, config, "Demo", 12).lede).toBe(
      "Every DAW session in Demo — 12 sessions."
    );
  });

  it("writes a count of one in the singular", () => {
    expect(listCopy(session, config, "Demo", 1).lede).toBe(
      "Every DAW session in Demo — 1 session."
    );
  });

  it("pluralises a count of zero", () => {
    expect(listCopy(session, config, "Demo", 0).lede).toBe(
      "Every DAW session in Demo — 0 sessions."
    );
  });
});

describe("archivedListCopy", () => {
  it("names the page from the kind's nouns and crumbs it as Archived", () => {
    expect(archivedListCopy(track)).toMatchObject({
      title: "Archived tracks",
      crumb: "Archived",
      empty: "Nothing archived yet",
    });
  });

  it("reads whole without a count", () => {
    expect(archivedListCopy(track).lede).toBe(
      "Hidden from Tracks and Sessions"
    );
  });

  it("pluralises a count of zero", () => {
    expect(archivedListCopy(track, 0).lede).toBe(
      "0 archived tracks · hidden from Tracks and Sessions"
    );
  });

  it("writes a count of one in the singular", () => {
    expect(archivedListCopy(track, 1).lede).toBe(
      "1 archived track · hidden from Tracks and Sessions"
    );
  });

  it("opens the lede with the count once it is known", () => {
    expect(archivedListCopy(track, 3).lede).toBe(
      "3 archived tracks · hidden from Tracks and Sessions"
    );
  });
});
