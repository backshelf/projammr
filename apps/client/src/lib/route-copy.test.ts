import { describe, expect, it } from "bun:test";
import { errorCopy, notFoundCopy } from "./route-copy";
import type { ParsedRoute } from "./route-parser";

const TRACK: ParsedRoute = { kind: "track", trackId: 12 };
const TRACK_ALL: ParsedRoute = { kind: "track-all" };
const PLUGINS: ParsedRoute = { kind: "plugins" };
const NOT_FOUND: ParsedRoute = { kind: "not-found" };
const PROJECT: ParsedRoute = { kind: "project" };

describe("errorCopy", () => {
  it("words a row route with the kind's singular noun", () => {
    expect(errorCopy(TRACK).title).toBe("Couldn't load this track");
  });

  it("words a list route's error with the plural", () => {
    expect(errorCopy(TRACK_ALL).title).toBe("Couldn't load tracks");
  });

  it("a route that names no kind reads as a page", () => {
    expect(errorCopy(PLUGINS).title).toBe("Couldn't load this page");
  });

  it("a malformed URL reads as a page", () => {
    expect(errorCopy(NOT_FOUND).title).toBe("Couldn't load this page");
  });

  it("links back to the project for every kind", () => {
    expect(errorCopy(TRACK).link).toEqual({
      label: "Back to project",
      route: { kind: "project" },
    });
  });
});

describe("notFoundCopy", () => {
  it("words a row route with the kind's singular noun", () => {
    const copy = notFoundCopy(TRACK);
    expect(copy.title).toBe("Track not found");
    expect(copy.body).toBe(
      "This track doesn't exist, or you don't have access to it."
    );
  });

  it("words a list route with the same singular noun", () => {
    expect(notFoundCopy(TRACK_ALL).title).toBe("Track not found");
  });

  it("a route that names no kind reads as a page", () => {
    const copy = notFoundCopy(PLUGINS);
    expect(copy.title).toBe("Page not found");
    expect(copy.body).toBe(
      "This page doesn't exist, or you don't have access to it."
    );
  });

  it("a malformed URL reads as a page", () => {
    expect(notFoundCopy(NOT_FOUND).title).toBe("Page not found");
  });

  it("the not-found link of a kind is its list route; of a page, the project root", () => {
    expect(notFoundCopy(TRACK).link).toEqual({
      label: "All tracks",
      route: { kind: "track-all" },
    });
    expect(notFoundCopy(PLUGINS).link).toEqual({
      label: "Back to project",
      route: { kind: "project" },
    });
  });

  it("a kind with no list route links back to the project", () => {
    const copy = notFoundCopy(PROJECT);
    expect(copy.title).toBe("Project not found");
    expect(copy.link).toEqual({
      label: "Back to project",
      route: { kind: "project" },
    });
  });
});
