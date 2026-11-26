import { describe, expect, it } from "bun:test";

import { sessionFromDraft } from "./session-draft";

describe("sessionFromDraft", () => {
  it("assigns a session drafted on a track's page to that track", () => {
    const session = sessionFromDraft(
      { name: "Main mix", priority: 11, trackId: null },
      7,
      42
    );

    expect(session.trackId).toBe(42);
  });

  it("keeps the track a group header seeded over the page's track", () => {
    const session = sessionFromDraft(
      { name: "Main mix", priority: 14, trackId: "9" },
      7,
      42
    );

    expect(session).toEqual({
      name: "Main mix",
      daw: "manual",
      dawName: undefined,
      priorityId: 14,
      trackId: 9,
      projectId: 7,
    });
  });

  it("writes the drafted level's id, whichever level it is", () => {
    const session = sessionFromDraft(
      { name: "Sketch", priority: 11, trackId: null },
      7
    );

    expect(session.priorityId).toBe(11);
  });

  it("leaves the level to the server when the draft names none", () => {
    const session = sessionFromDraft(
      { name: "Sketch", priority: null, trackId: null },
      7
    );

    expect(session.trackId).toBeUndefined();
    expect(session.priorityId).toBeUndefined();
  });

  it("tags a row with no dit repo behind it as added by hand", () => {
    const session = sessionFromDraft({ name: "Sketch", trackId: null }, 7);

    expect(session.daw).toBe("manual");
  });

  it("carries a DAW group header's seeded module id rather than manual", () => {
    const session = sessionFromDraft(
      { name: "Bounce", daw: "ableton", trackId: null },
      7
    );

    expect(session.daw).toBe("ableton");
  });

  it("carries a typed DAW name onto the new session", () => {
    const session = sessionFromDraft(
      { name: "Sketch", dawName: "Cubase", trackId: null },
      7
    );

    expect(session.dawName).toBe("Cubase");
  });
});
