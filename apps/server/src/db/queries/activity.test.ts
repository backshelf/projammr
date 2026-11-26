import { describe, expect, it } from "bun:test";
import { SESSION_ACTIVITY_IGNORED_FIELDS } from "../../entities/session/queries.js";
import { diffFields } from "./activity.js";

describe("diffFields", () => {
  it("reports only the fields that changed", () => {
    expect(
      diffFields(
        { title: "Before", artists: ["A"] },
        { title: "After", artists: ["A"] }
      )
    ).toEqual({ title: { from: "Before", to: "After" } });
  });

  it("ignores the timestamps and the id", () => {
    expect(
      diffFields(
        { id: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", title: "T" },
        { id: 2, createdAt: "2026-02-02", updatedAt: "2026-02-02", title: "T" }
      )
    ).toEqual({});
  });

  it("reports a field being filled in", () => {
    expect(diffFields({ bpm: null }, { bpm: "120" })).toEqual({
      bpm: { from: null, to: "120" },
    });
  });

  it("reports a field being cleared", () => {
    expect(diffFields({ bpm: "120" }, { bpm: null })).toEqual({
      bpm: { from: "120", to: null },
    });
  });

  it("writes undefined out as null", () => {
    expect(diffFields({}, { bpm: "120" })).toEqual({
      bpm: { from: null, to: "120" },
    });
  });

  it("leaves a jsonb column alone when it is deep-equal", () => {
    expect(
      diffFields(
        { links: [{ name: "Drive", url: "https://drive.test" }] },
        { links: [{ name: "Drive", url: "https://drive.test" }] }
      )
    ).toEqual({});
  });

  it("reports a jsonb column whose contents moved", () => {
    const from = [{ name: "Drive", url: "https://drive.test" }];
    const to = [{ name: "Drive", url: "https://drive.test/v2" }];

    expect(diffFields({ links: from }, { links: to })).toEqual({
      links: { from, to },
    });
  });

  it("says nothing about a field the new row does not carry", () => {
    // The diff walks `after`, so a patch that returns a narrower row reports
    // no change rather than claiming every absent column was cleared.
    expect(diffFields({ title: "T", bpm: "120" }, { title: "T" })).toEqual({});
  });

  it("ignores a session's machine-written fields alongside a real change", () => {
    expect(
      diffFields(
        {
          tempo: 120,
          fingerprint: "1024:abc",
          localFileUpdatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          tempo: 128,
          fingerprint: "1024:def",
          localFileUpdatedAt: "2026-01-02T00:00:00.000Z",
        },
        SESSION_ACTIVITY_IGNORED_FIELDS
      )
    ).toEqual({ tempo: { from: 120, to: 128 } });
  });

  it("ignores the generated notesText alongside a real change", () => {
    // `notesText` derives from `notes`, and the feed already hides `notes`
    // itself; recording `notesText` too would print the note's whole body.
    expect(
      diffFields(
        { title: "Before", notes: [{ type: "paragraph" }], notesText: "old" },
        { title: "After", notes: [{ type: "paragraph" }], notesText: "new" }
      )
    ).toEqual({ title: { from: "Before", to: "After" } });
  });

  it("reports no change when only a session's machine-written fields moved", () => {
    expect(
      diffFields(
        {
          fingerprint: "1024:abc",
          localFileUpdatedAt: "2026-01-01T00:00:00.000Z",
        },
        {
          fingerprint: "1024:def",
          localFileUpdatedAt: "2026-01-02T00:00:00.000Z",
        },
        SESSION_ACTIVITY_IGNORED_FIELDS
      )
    ).toEqual({});
  });
});
