import { HIGH, NONE, SEEDED_SCALE } from "@/fields/priority-fixture";
import { selectOptions } from "@/fields/select-fixture";
import type { FieldConfig } from "@/fields/types";
import { describe, expect, it } from "bun:test";

import {
  draftFieldsFrom,
  type NewRowFieldConfig,
  validateDraft,
} from "./new-row";

type StatusList = NonNullable<FieldConfig["statuses"]>;
const mixing = { id: 2, name: "Mixing" } as StatusList[number];
const done = { id: 4, name: "Done" } as StatusList[number];
const statuses: StatusList = [mixing, done];

describe("validateDraft", () => {
  const fields: Record<string, NewRowFieldConfig> = {
    title: { type: "text", required: true },
    artists: { type: "text" },
    statusId: { type: "status", statuses },
    releaseDate: { type: "date" },
  };

  it("parses every declared field with its kind", () => {
    const result = validateDraft(fields, {
      title: "Song",
      artists: "A, B",
      statusId: "2",
      releaseDate: "2026-01-01",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Song",
        artists: "A, B",
        statusId: 2,
        releaseDate: "2026-01-01",
      },
    });
  });

  it("trims text and parses a number", () => {
    const result = validateDraft(
      { title: { type: "text" }, bpm: { type: "number" } },
      { title: "  hello  ", bpm: "120" }
    );
    expect(result).toEqual({ ok: true, value: { title: "hello", bpm: 120 } });
  });

  it("reads a blank optional field as null", () => {
    const result = validateDraft(
      {
        title: { type: "text" },
        bpm: { type: "number" },
        releaseDate: { type: "date" },
      },
      { title: "   ", bpm: "" }
    );
    expect(result).toEqual({
      ok: true,
      value: { title: null, bpm: null, releaseDate: null },
    });
  });

  it("reports empty required fields in declaration order", () => {
    const twoRequired: Record<string, NewRowFieldConfig> = {
      name: { type: "text", required: true },
      daw: {
        type: "select",
        required: true,
        options: selectOptions("Ableton"),
      },
    };
    const result = validateDraft(twoRequired, { name: "  ", daw: "" });
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "name", error: "Required" },
        { field: "daw", error: "Required" },
      ],
    });
  });

  it("passes when a required field is filled and optionals are blank", () => {
    const result = validateDraft(fields, { title: "Song" });
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Song",
        artists: null,
        statusId: null,
        releaseDate: null,
      },
    });
  });

  it("seeds an untouched field from initialValues", () => {
    const result = validateDraft(fields, { title: "Song" }, { statusId: 4 });
    expect(result.ok && result.value.statusId).toBe(4);
  });

  it("a seeded field satisfies the required check", () => {
    const oneRequired: Record<string, NewRowFieldConfig> = {
      name: { type: "text", required: true },
    };
    const result = validateDraft(oneRequired, {}, { name: "Seeded" });
    expect(result).toEqual({ ok: true, value: { name: "Seeded" } });
  });

  it("draft wins over an unlocked seed", () => {
    const result = validateDraft(
      fields,
      { title: "Song", statusId: "2" },
      { statusId: 4 }
    );
    expect(result.ok && result.value.statusId).toBe(2);
  });

  it("a locked seed always wins over the draft", () => {
    const result = validateDraft(
      fields,
      { title: "Song", statusId: "2" },
      { statusId: 4 },
      ["statusId"]
    );
    expect(result.ok && result.value.statusId).toBe(4);
  });

  it("carries a seeded group value through as it is", () => {
    const sessionFields: Record<string, NewRowFieldConfig> = {
      name: { type: "text", required: true },
      daw: {
        type: "select",
        required: true,
        options: selectOptions("Ableton"),
      },
    };
    const result = validateDraft(
      sessionFields,
      { name: "S" },
      { daw: "Ableton" },
      ["daw"]
    );
    expect(result).toEqual({
      ok: true,
      value: { name: "S", daw: "Ableton" },
    });
  });

  it("errors on a select option the field does not offer", () => {
    const result = validateDraft(
      { daw: { type: "select", options: selectOptions("Ableton", "Logic") } },
      { daw: "Reaper" }
    );
    expect(result).toEqual({
      ok: false,
      errors: [{ field: "daw", error: "Not one of the options" }],
    });
  });

  it("returns a select option as the field spells it", () => {
    const result = validateDraft(
      { daw: { type: "select", options: selectOptions("Ableton") } },
      { daw: "ableton" }
    );
    expect(result).toEqual({ ok: true, value: { daw: "Ableton" } });
  });

  it("errors on a malformed date", () => {
    for (const releaseDate of ["01/02/2026", "2026-02-30", "soon"]) {
      const result = validateDraft(
        { releaseDate: { type: "date" } },
        { releaseDate }
      );
      expect(result).toEqual({
        ok: false,
        errors: [
          { field: "releaseDate", error: "Must be a date (YYYY-MM-DD)" },
        ],
      });
    }
  });

  it("errors on a non-numeric number", () => {
    const result = validateDraft({ bpm: { type: "number" } }, { bpm: "fast" });
    expect(result).toEqual({
      ok: false,
      errors: [{ field: "bpm", error: "Must be a number" }],
    });
  });

  it("errors on a status the field does not offer", () => {
    const result = validateDraft(
      { statusId: { type: "status", statuses } },
      {
        statusId: "9",
      }
    );
    expect(result).toEqual({
      ok: false,
      errors: [{ field: "statusId", error: "Not a status" }],
    });
  });

  it("shows the parse error, not Required, for a required field that fails to parse", () => {
    const result = validateDraft(
      { bpm: { type: "number", required: true } },
      { bpm: "fast" }
    );
    expect(result).toEqual({
      ok: false,
      errors: [{ field: "bpm", error: "Must be a number" }],
    });
  });

  it("reports one error per field, parse failures beside empty required fields", () => {
    const result = validateDraft(
      {
        name: { type: "text", required: true },
        bpm: { type: "number" },
        releaseDate: { type: "date" },
      },
      { bpm: "fast", releaseDate: "nope" }
    );
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: "name", error: "Required" },
        { field: "bpm", error: "Must be a number" },
        { field: "releaseDate", error: "Must be a date (YYYY-MM-DD)" },
      ],
    });
  });

  it("reads an untouched checkbox as false", () => {
    const result = validateDraft({ mastered: { type: "checkbox" } }, {});
    expect(result).toEqual({ ok: true, value: { mastered: false } });
  });

  it("parses a ticked checkbox to true and rejects other text", () => {
    const checkbox: Record<string, NewRowFieldConfig> = {
      mastered: { type: "checkbox" },
    };
    expect(validateDraft(checkbox, { mastered: "true" })).toEqual({
      ok: true,
      value: { mastered: true },
    });
    expect(validateDraft(checkbox, { mastered: "yes" })).toEqual({
      ok: false,
      errors: [{ field: "mastered", error: "Must be true or false" }],
    });
  });

  it("reads an untouched priority as the default level and rejects an unknown one", () => {
    const priority: Record<string, NewRowFieldConfig> = {
      priority: { type: "priority", priorityLevels: SEEDED_SCALE },
    };
    expect(validateDraft(priority, {})).toEqual({
      ok: true,
      value: { priority: NONE.id },
    });
    expect(validateDraft(priority, { priority: "High" })).toEqual({
      ok: true,
      value: { priority: HIGH.id },
    });
    expect(validateDraft(priority, { priority: "asap" })).toEqual({
      ok: false,
      errors: [{ field: "priority", error: "Not a priority" }],
    });
  });

  it("keeps a priority a group header seeded as its level id", () => {
    const priority: Record<string, NewRowFieldConfig> = {
      priority: { type: "priority", priorityLevels: SEEDED_SCALE },
    };
    expect(
      validateDraft(priority, {}, { priority: HIGH.id }, ["priority"])
    ).toEqual({ ok: true, value: { priority: HIGH.id } });
  });

  it("splits a list field into an array, and reads a blank one as []", () => {
    const list: Record<string, NewRowFieldConfig> = {
      artists: { type: "list" },
    };
    expect(validateDraft(list, { artists: " A,B , ,C " })).toEqual({
      ok: true,
      value: { artists: ["A", "B", "C"] },
    });
    expect(validateDraft(list, { artists: "  " })).toEqual({
      ok: true,
      value: { artists: [] },
    });
    expect(validateDraft(list, {})).toEqual({
      ok: true,
      value: { artists: [] },
    });
  });

  it("rejects a blank required list field", () => {
    expect(
      validateDraft({ artists: { type: "list", required: true } }, {})
    ).toEqual({
      ok: false,
      errors: [{ field: "artists", error: "Required" }],
    });
  });

  it("accepts any text for a suggest field", () => {
    const suggest: Record<string, NewRowFieldConfig> = {
      dawName: { type: "suggest", suggestions: ["Ableton Live"] },
    };
    expect(validateDraft(suggest, { dawName: "Bitwig" })).toEqual({
      ok: true,
      value: { dawName: "Bitwig" },
    });
  });
});

describe("draftFieldsFrom", () => {
  const editable = {
    title: { type: "text", placeholder: "Title", required: true },
    artists: { type: "text", placeholder: "Names" },
    status: { type: "status", statuses: [mixing] },
    priority: { type: "select", options: selectOptions("none", "low") },
    genre: { type: "text", suggestions: ["Ambient", "Dub"] },
    isrc: { type: "text" },
  } satisfies Record<string, NewRowFieldConfig>;

  it("picks the named columns and carries type, placeholder, required and options", () => {
    expect(draftFieldsFrom(editable, ["title", "artists", "priority"])).toEqual(
      {
        title: { type: "text", placeholder: "Title", required: true },
        artists: { type: "text", placeholder: "Names" },
        priority: { type: "select", options: selectOptions("none", "low") },
      }
    );
  });

  it("carries statuses and suggestions through", () => {
    expect(draftFieldsFrom(editable, ["status", "genre"])).toEqual({
      status: { type: "status", statuses: [mixing] },
      genre: { type: "text", suggestions: ["Ambient", "Dub"] },
    });
  });

  it("carries the priority scale through, so a draft parses a level by name", () => {
    const fields = draftFieldsFrom(
      { level: { type: "priority", priorityLevels: SEEDED_SCALE } },
      ["level"]
    );
    expect(fields).toEqual({
      level: { type: "priority", priorityLevels: SEEDED_SCALE },
    });
    expect(validateDraft(fields, { level: "High" })).toEqual({
      ok: true,
      value: { level: HIGH.id },
    });
  });

  it("skips ids with no editable config and appends extras", () => {
    expect(
      draftFieldsFrom(editable, ["title", "missing"], {
        collection: { type: "number" },
      })
    ).toEqual({
      title: { type: "text", placeholder: "Title", required: true },
      collection: { type: "number" },
    });
  });

  it("keeps an extra named in ids at its listed position, required flag intact", () => {
    const fields = draftFieldsFrom(editable, ["title", "artists", "priority"], {
      title: { type: "text", placeholder: "Track title", required: true },
    });

    expect(Object.keys(fields)).toEqual(["title", "artists", "priority"]);
    expect(fields.title).toEqual({
      type: "text",
      placeholder: "Track title",
      required: true,
    });
  });

  it("takes a column absent from editable from extras when ids names it", () => {
    const withoutTitle = Object.fromEntries(
      Object.entries(editable).filter(([id]) => id !== "title")
    ) as Record<string, NewRowFieldConfig>;

    const fields = draftFieldsFrom(withoutTitle, ["title", "artists"], {
      title: { type: "text", placeholder: "Track title", required: true },
    });

    expect(Object.keys(fields)).toEqual(["title", "artists"]);
    expect(fields.title?.required).toBe(true);
  });
});
