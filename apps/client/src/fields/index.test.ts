import { FIELD_KINDS, describeValue, fieldKind } from "@/fields";
import { HIGH, NONE } from "@/fields/priority-fixture";
import { selectOptions } from "@/fields/select-fixture";
import type { FieldConfig, FieldKindName, ParseResult } from "@/fields/types";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { describe, expect, it } from "bun:test";

const none: FieldConfig = {};
const required: FieldConfig = { required: true };

describe("fieldKind", () => {
  it("returns the module registered under a name", () => {
    expect(fieldKind("text")).toBe(FIELD_KINDS.text);
    expect(fieldKind("number")).toBe(FIELD_KINDS.number);
  });

  it.each([
    "text",
    "number",
    "date",
    "select",
    "status",
    "checkbox",
    "priority",
    "list",
    "suggest",
  ] satisfies FieldKindName[])("resolves %p to its module", (name) => {
    expect(fieldKind(name)).toBe(FIELD_KINDS[name]);
  });

  it("throws on a name from outside the registry", () => {
    expect(() => fieldKind("nope" as FieldKindName)).toThrow(
      'No field kind is registered for "nope"'
    );
  });
});

describe("describeValue", () => {
  const formatters = defaultFormatters();

  it("writes a date field's day as the formatter set's date", () => {
    expect(describeValue({ type: "date" }, "2026-08-03", formatters)).toBe(
      "3 Aug 2026"
    );
  });

  it("writes a number field grouped", () => {
    expect(describeValue({ type: "number" }, 12345, formatters)).toBe("12,345");
  });

  it("writes a box as Yes or No and text as itself", () => {
    expect(describeValue({ type: "checkbox" }, true, formatters)).toBe("Yes");
    expect(describeValue({ type: "text" }, "Logic", formatters)).toBe("Logic");
  });

  it("leaves what the editor shows raw", () => {
    expect(fieldKind("date").format("2026-08-03", none)).toBe("2026-08-03");
    expect(fieldKind("number").format(12345, none)).toBe("12345");
  });
});

describe("text", () => {
  const { parse, format } = fieldKind("text");

  it("trims what it parses", () => {
    expect(parse("  Kick  ", none)).toEqual({ ok: true, value: "Kick" });
  });

  it("parses blank to null", () => {
    expect(parse("", none)).toEqual({ ok: true, value: null });
    expect(parse("   ", none)).toEqual({ ok: true, value: null });
  });

  it("rejects blank with Required when the field is required", () => {
    expect(parse("  ", required)).toEqual({ ok: false, error: "Required" });
  });

  it("keeps digits as text", () => {
    expect(parse("12", none)).toEqual({ ok: true, value: "12" });
  });

  it("formats null as an empty string", () => {
    expect(format(null, none)).toBe("");
  });

  it("formats a value as its text", () => {
    expect(format("Kick", none)).toBe("Kick");
  });
});

describe("number", () => {
  const { parse, format } = fieldKind("number");

  it("parses integers and decimals, trimmed", () => {
    expect(parse(" 42 ", none)).toEqual({ ok: true, value: 42 });
    expect(parse("-1.5", none)).toEqual({ ok: true, value: -1.5 });
    expect(parse("0", none)).toEqual({ ok: true, value: 0 });
  });

  it("parses blank to null", () => {
    expect(parse("", none)).toEqual({ ok: true, value: null });
  });

  it("rejects blank with Required when the field is required", () => {
    expect(parse("", required)).toEqual({ ok: false, error: "Required" });
  });

  it.each(["1,5", "12abc", "abc", "Infinity", "-Infinity", "NaN"])(
    "rejects %p as not a number",
    (raw) => {
      expect(parse(raw, none)).toEqual({
        ok: false,
        error: "Must be a number",
      });
    }
  );

  it("formats null as an empty string", () => {
    expect(format(null, none)).toBe("");
  });

  it("formats a value as its digits", () => {
    expect(format(1.5, none)).toBe("1.5");
    expect(format(0, none)).toBe("0");
  });
});

describe("date", () => {
  const { parse, format } = fieldKind("date");

  it("accepts a calendar date, trimmed", () => {
    expect(parse("2026-03-04", none)).toEqual({
      ok: true,
      value: "2026-03-04",
    });
    expect(parse(" 2026-03-04 ", none)).toEqual({
      ok: true,
      value: "2026-03-04",
    });
  });

  it("accepts 29 February in a leap year", () => {
    expect(parse("2028-02-29", none)).toEqual({
      ok: true,
      value: "2028-02-29",
    });
    expect(parse("2000-02-29", none)).toEqual({
      ok: true,
      value: "2000-02-29",
    });
  });

  it("parses blank to null", () => {
    expect(parse("", none)).toEqual({ ok: true, value: null });
  });

  it("rejects blank with Required when the field is required", () => {
    expect(parse(" ", required)).toEqual({ ok: false, error: "Required" });
  });

  it.each([
    "2026-02-30",
    "2026-02-29",
    "1900-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-01-00",
    "2026-3-4",
    "26-03-04",
    "2026/03/04",
    "03/04/2026",
    "2026-03-04T10:00:00Z",
    "March 4",
    "20260304",
  ])("rejects %p as not a date", (raw) => {
    expect(parse(raw, none)).toEqual({
      ok: false,
      error: "Must be a date (YYYY-MM-DD)",
    });
  });

  it("formats null as an empty string and a date as itself", () => {
    expect(format(null, none)).toBe("");
    expect(format("2026-03-04", none)).toBe("2026-03-04");
  });
});

describe("select", () => {
  const { parse, format } = fieldKind("select");
  const options: FieldConfig = {
    options: [
      { value: "o1", label: "Idea" },
      { value: "o2", label: "Demo" },
      { value: "o3", label: "Final Mix" },
    ],
  };

  it("accepts an option by its label and returns its value", () => {
    expect(parse("Demo", options)).toEqual({ ok: true, value: "o2" });
  });

  it("matches a label case-insensitively", () => {
    expect(parse("demo", options)).toEqual({ ok: true, value: "o2" });
    expect(parse("  FINAL MIX ", options)).toEqual({
      ok: true,
      value: "o3",
    });
  });

  it("accepts an option by its value", () => {
    expect(parse("o3", options)).toEqual({ ok: true, value: "o3" });
  });

  it("parses blank to null", () => {
    expect(parse("", options)).toEqual({ ok: true, value: null });
  });

  it("rejects blank with Required when the field is required", () => {
    expect(parse("", { ...options, required: true })).toEqual({
      ok: false,
      error: "Required",
    });
  });

  it("rejects text that is not an option", () => {
    expect(parse("Master", options)).toEqual({
      ok: false,
      error: "Not one of the options",
    });
    expect(parse("Final", options)).toEqual({
      ok: false,
      error: "Not one of the options",
    });
  });

  it("rejects every non-blank value when there are no options", () => {
    const notAnOption: ParseResult = {
      ok: false,
      error: "Not one of the options",
    };
    expect(parse("Demo", none)).toEqual(notAnOption);
    expect(parse("Demo", { options: [] })).toEqual(notAnOption);
    expect(parse("", none)).toEqual({ ok: true, value: null });
  });

  it("formats null as an empty string and an option's value as its label", () => {
    expect(format(null, options)).toBe("");
    expect(format("o2", options)).toBe("Demo");
  });

  it("formats a value no option has any more as the value itself", () => {
    expect(format("removed-id", options)).toBe("removed-id");
  });
});

describe("url", () => {
  const { parse, format } = fieldKind("url");

  it("accepts an absolute link, trimmed", () => {
    expect(parse("  https://stems.example.com/a  ", none)).toEqual({
      ok: true,
      value: "https://stems.example.com/a",
    });
  });

  it("rejects a link with no scheme", () => {
    expect(parse("stems.example.com/a", none)).toEqual({
      ok: false,
      error: "Must be a full link (https://…)",
    });
  });

  it("rejects a scheme other than http or https", () => {
    for (const raw of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://a.b",
    ]) {
      expect(parse(raw, none)).toEqual({
        ok: false,
        error: "Must be a full link (https://…)",
      });
    }
  });

  it("parses blank to null, or Required when the field is", () => {
    expect(parse("", none)).toEqual({ ok: true, value: null });
    expect(parse(" ", { required: true })).toEqual({
      ok: false,
      error: "Required",
    });
  });

  it("formats a link as itself", () => {
    expect(format("https://a.example/x", none)).toBe("https://a.example/x");
    expect(format(null, none)).toBe("");
  });
});

describe("checkbox", () => {
  const { parse, format, entry } = fieldKind("checkbox");

  it("toggles rather than opening an editor", () => {
    expect(entry).toBe("toggle");
    expect(fieldKind("checkbox").Editor).toBeUndefined();
  });

  it("parses true and false, case-insensitively and trimmed", () => {
    expect(parse("true", none)).toEqual({ ok: true, value: true });
    expect(parse(" TRUE ", none)).toEqual({ ok: true, value: true });
    expect(parse("false", none)).toEqual({ ok: true, value: false });
    expect(parse("False", none)).toEqual({ ok: true, value: false });
  });

  it("parses blank to false", () => {
    expect(parse("", none)).toEqual({ ok: true, value: false });
    expect(parse("  ", none)).toEqual({ ok: true, value: false });
  });

  it("ignores required: false is a value", () => {
    expect(parse("", required)).toEqual({ ok: true, value: false });
    expect(parse("false", required)).toEqual({ ok: true, value: false });
  });

  it.each(["yes", "no", "1", "0", "on", "truee"])(
    "rejects %p as not a boolean",
    (raw) => {
      expect(parse(raw, none)).toEqual({
        ok: false,
        error: "Must be true or false",
      });
    }
  );

  it("formats a value as true or false, null as false", () => {
    expect(format(true, none)).toBe("true");
    expect(format(false, none)).toBe("false");
    expect(format(null, none)).toBe("false");
  });
});

describe("status", () => {
  const kind = fieldKind("status");
  const { parse, format } = kind;
  const { optimisticPatch } = FIELD_KINDS.status;
  const draft = { id: 2, name: "Mixing" } as NonNullable<
    FieldConfig["statuses"]
  >[number];
  const done = { id: 7, name: "Done" } as typeof draft;
  const config: FieldConfig = { statuses: [draft, done] };

  it("is entered through its own menu and takes no pasted text", () => {
    expect(kind.entry).toBe("self");
    expect(kind.Editor).toBeUndefined();
    expect(kind.paste).toBe(false);
    expect(kind.saveAs).toBe("statusId");
  });

  it("parses the id of a known status as a number", () => {
    expect(parse("7", config)).toEqual({ ok: true, value: 7 });
    expect(parse(" 2 ", config)).toEqual({ ok: true, value: 2 });
  });

  it.each(["9", "0", "1.5", "Done", "abc"])(
    "rejects %p as not a status",
    (raw) => {
      expect(parse(raw, config)).toEqual({ ok: false, error: "Not a status" });
    }
  );

  it("rejects every non-blank value when there are no statuses", () => {
    expect(parse("7", none)).toEqual({ ok: false, error: "Not a status" });
    expect(parse("7", { statuses: [] })).toEqual({
      ok: false,
      error: "Not a status",
    });
  });

  it("parses blank to null, or Required when the field is", () => {
    expect(parse("", config)).toEqual({ ok: true, value: null });
    expect(parse("  ", { ...config, required: true })).toEqual({
      ok: false,
      error: "Required",
    });
  });

  it("formats a status id as its name", () => {
    expect(format(7, config)).toBe("Done");
  });

  it("formats null and an unknown id as an empty string", () => {
    expect(format(null, config)).toBe("");
    expect(format(9, config)).toBe("");
    expect(format(7, none)).toBe("");
  });

  it("patches the row with the id and the status it names", () => {
    expect(optimisticPatch(7, config)).toEqual({ statusId: 7, status: done });
  });

  it("patches a numeric string id the way a number does", () => {
    expect(optimisticPatch("7", config)).toEqual({ statusId: 7, status: done });
  });

  it("patches a null id with a null status", () => {
    expect(optimisticPatch(null, config)).toEqual({
      statusId: null,
      status: null,
    });
  });

  it("patches an id with no status behind it with a null status", () => {
    expect(optimisticPatch(9, config)).toEqual({ statusId: 9, status: null });
  });
});

describe("priority", () => {
  const { parse, format, ...kind } = fieldKind("priority");
  // A scale of two: a name another project's scale has is no level here.
  const scale: FieldConfig = { priorityLevels: [NONE, HIGH] };

  it("is entered through its editor, can be pasted into and saves the level id", () => {
    expect(kind.entry).toBe("editor");
    expect(kind.paste).toBe(true);
    expect(kind.saveAs).toBe("priorityId");
  });

  it("parses a level's name or id to its id, trimmed", () => {
    expect(parse(" High ", scale)).toEqual({ ok: true, value: HIGH.id });
    expect(parse(String(HIGH.id), scale)).toEqual({ ok: true, value: HIGH.id });
  });

  it("parses blank to the default level, even when the field is required", () => {
    expect(parse("", scale)).toEqual({ ok: true, value: NONE.id });
    expect(parse("  ", { ...scale, required: true })).toEqual({
      ok: true,
      value: NONE.id,
    });
  });

  it.each(["critical", "urgent"])("rejects %p as not a priority", (raw) => {
    expect(parse(raw, scale)).toEqual({ ok: false, error: "Not a priority" });
  });

  it("ignores config.options", () => {
    expect(parse("a", { ...scale, options: selectOptions("a", "b") })).toEqual({
      ok: false,
      error: "Not a priority",
    });
  });

  it("formats a level id as the level's name", () => {
    expect(format(HIGH.id, scale)).toBe("High");
    expect(format(null, none)).toBe("");
  });
});

describe("list", () => {
  const { parse, format, ...kind } = fieldKind("list");

  it("is entered through its editor and can be pasted into", () => {
    expect(kind.entry).toBe("editor");
    expect(kind.paste).toBe(true);
  });

  it("splits on commas, trimming each entry", () => {
    expect(parse("Ada, Bea ,Cy", none)).toEqual({
      ok: true,
      value: ["Ada", "Bea", "Cy"],
    });
  });

  it("drops blank entries", () => {
    expect(parse("a,,b , ", none)).toEqual({ ok: true, value: ["a", "b"] });
  });

  it("does not deduplicate", () => {
    expect(parse("a, b, a", none)).toEqual({
      ok: true,
      value: ["a", "b", "a"],
    });
  });

  it("parses blank to an empty list", () => {
    expect(parse("", none)).toEqual({ ok: true, value: [] });
    expect(parse(" , ,", none)).toEqual({ ok: true, value: [] });
  });

  it("rejects blank with Required when the field is required", () => {
    expect(parse("  ", required)).toEqual({ ok: false, error: "Required" });
    expect(parse(" , ", required)).toEqual({ ok: false, error: "Required" });
  });

  it("formats entries joined with a comma and a space", () => {
    expect(format(["Ada", "Bea"], none)).toBe("Ada, Bea");
  });

  it("formats null and an empty list as an empty string", () => {
    expect(format(null, none)).toBe("");
    expect(format([], none)).toBe("");
  });

  it("round-trips through format and parse", () => {
    const entries = ["Ada", "Bea", "Ada"];
    expect(parse(format(entries, none), none)).toEqual({
      ok: true,
      value: entries,
    });
  });
});

describe("suggest", () => {
  const { parse, format } = fieldKind("suggest");
  const suggestions: FieldConfig = { suggestions: ["Ableton Live", "Logic"] };

  it("accepts any text, trimmed, whether or not it is a suggestion", () => {
    expect(parse(" Logic ", suggestions)).toEqual({ ok: true, value: "Logic" });
    expect(parse("Reaper", suggestions)).toEqual({ ok: true, value: "Reaper" });
    expect(parse("Reaper", none)).toEqual({ ok: true, value: "Reaper" });
  });

  it("parses blank to null, or Required when the field is", () => {
    expect(parse("", suggestions)).toEqual({ ok: true, value: null });
    expect(parse("  ", { ...suggestions, required: true })).toEqual({
      ok: false,
      error: "Required",
    });
  });

  it("formats null as an empty string and a value as itself", () => {
    expect(format(null, suggestions)).toBe("");
    expect(format("Logic", suggestions)).toBe("Logic");
  });
});
