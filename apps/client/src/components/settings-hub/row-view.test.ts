import { describe, expect, it } from "bun:test";
import { defineSetting } from "@workspace/settings";
import { z } from "zod";
import { rowView } from "./row-view";
import type { HubRow } from "./types";

/** A member default an editor may write at a project: the key's `minRole` sits below the role that locks. */
const editorKey = defineSetting({
  key: "fixture.editorWritable",
  group: "fixture",
  label: "Editor writable",
  description: "A setting declared by a test.",
  keywords: [],
  audience: "all",
  scopes: ["user", "project", "instance"],
  schema: z.string(),
  default: "d",
  control: { kind: "text" },
});

const EDITOR: Pick<HubRow, "writable" | "lockable"> = {
  writable: { user: true, project: true, instance: false },
  lockable: { user: false, project: false, instance: false },
};

const ADMIN: Pick<HubRow, "writable" | "lockable"> = {
  writable: { user: true, project: true, instance: false },
  lockable: { user: false, project: true, instance: false },
};

const row = (fields: Partial<HubRow>): HubRow => ({
  effective: "p",
  source: "project",
  values: { project: "p" },
  ...EDITOR,
  ...fields,
});

describe("rowView's lock", () => {
  it("offers a project row's lock to a caller the server lets lock there", () => {
    const view = rowView(editorKey, "project", row(ADMIN));

    expect(view.lock).toEqual({ locked: false });
  });

  it("offers no lock to an editor who may write the key at the project", () => {
    const view = rowView(editorKey, "project", row(EDITOR));

    expect(view.editable).toBe(true);
    expect(view.lock).toBeUndefined();
  });

  it("offers no lock at a scope the server does not state a lock for", () => {
    const view = rowView(
      editorKey,
      "project",
      row({ ...ADMIN, lockable: { user: false } })
    );

    expect(view.lock).toBeUndefined();
  });
});

describe("rowView's Reset", () => {
  const lockedHere: Partial<HubRow> = { lockedBy: "project" };

  it("offers Reset on a row an editor holds a value on", () => {
    expect(rowView(editorKey, "project", row(EDITOR)).resettable).toBe(true);
  });

  it("offers no Reset on a row locked at its own scope to a caller who cannot lock there", () => {
    const view = rowView(
      editorKey,
      "project",
      row({ ...EDITOR, ...lockedHere })
    );

    expect(view.modified).toBe(true);
    expect(view.editable).toBe(true);
    expect(view.resettable).toBe(false);
  });

  it("offers Reset on a row locked at its own scope to a caller who can lock there", () => {
    const view = rowView(
      editorKey,
      "project",
      row({ ...ADMIN, ...lockedHere })
    );

    expect(view.resettable).toBe(true);
    expect(view.lock).toEqual({ locked: true });
  });

  it("offers no Reset on a row holding no value of its own, or one the caller may not write", () => {
    expect(
      rowView(editorKey, "project", row({ ...EDITOR, values: {} })).resettable
    ).toBe(false);
    expect(
      rowView(
        editorKey,
        "project",
        row({ writable: { project: false }, lockable: { project: true } })
      ).resettable
    ).toBe(false);
  });

  it("still offers a member Reset under an instance lock, which is the instance's to lift and not theirs", () => {
    const view = rowView(
      editorKey,
      "user",
      row({
        source: "instance",
        effective: "i",
        lockedBy: "instance",
        values: { user: "u", instance: "i" },
        writable: { user: true, instance: false },
        lockable: { user: false, instance: false },
      })
    );

    expect(view.resettable).toBe(true);
  });
});
