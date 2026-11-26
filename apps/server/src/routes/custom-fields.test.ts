import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { customFieldValues } from "../db/schema/custom-fields.js";
import { setupSuite } from "../test/fixtures.js";

const suite = setupSuite("Custom fields");
const { requireProject, request, expectAccess, mkTrack, throwawayProject } =
  suite;

type Field = {
  id: number;
  kind: string;
  name: string;
  type: string;
  options: { id: string; label: string; colour?: string }[];
  rank: number;
  valueCount: number;
  optionCounts?: Record<string, number>;
};

let nameCounter = 0;
const uniqueName = (label: string) => `${label} ${nameCounter++}`;

async function mkField(body: Record<string, unknown>): Promise<Field> {
  const res = await request("editor", `/projects/${suite.projectId}/fields`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Field;
}

async function listFields(kind?: string): Promise<Field[]> {
  const query = kind ? `?kind=${kind}` : "";
  const res = await request(
    "viewer",
    `/projects/${suite.projectId}/fields${query}`
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Field[];
}

describe("custom field definitions", () => {
  it("lets a viewer read and an editor write, and hides the project from outsiders", async () => {
    requireProject();
    const path = `/projects/${suite.projectId}/fields`;
    await expectAccess("GET", path, { viewer: 200, editor: 200 });
    await expectAccess(
      "POST",
      path,
      { viewer: 403 },
      { kind: "track", name: uniqueName("Gate"), type: "text" }
    );
  });

  it("creates fields after the kind's last one and lists them in rank order with value counts", async () => {
    requireProject();
    const first = await mkField({
      kind: "collection",
      name: uniqueName("Label"),
      type: "text",
    });
    const second = await mkField({
      kind: "collection",
      name: uniqueName("Catalogue"),
      type: "number",
    });
    expect(second.rank).toBe(first.rank + 1);
    expect(first.valueCount).toBe(0);

    const listed = await listFields("collection");
    const ids = listed.map((field) => field.id);
    expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    expect(listed.every((field) => field.kind === "collection")).toBe(true);
  });

  it("gives new select options ids and keeps the ids an edit names", async () => {
    requireProject();
    const field = await mkField({
      kind: "track",
      name: uniqueName("Mood"),
      type: "select",
      options: [{ label: "Happy", colour: "#ffcc00" }, { label: "Sad" }],
    });
    expect(field.options.map((o) => o.label)).toEqual(["Happy", "Sad"]);
    expect(field.options.every((o) => /^[A-Za-z0-9_-]+$/.test(o.id))).toBe(
      true
    );

    const [happy] = field.options;
    const res = await request(
      "editor",
      `/projects/${suite.projectId}/fields/${field.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          options: [{ id: happy!.id, label: "Joyful" }, { label: "Calm" }],
        }),
      }
    );
    expect(res.status).toBe(200);
    const edited = (await res.json()) as Field;
    expect(edited.options[0]).toEqual({ id: happy!.id, label: "Joyful" });
    expect(edited.options[1]!.label).toBe("Calm");
    expect(edited.options).toHaveLength(2);
  });

  it("refuses options on a field that is not a select, duplicate labels and unknown option ids", async () => {
    requireProject();
    const path = `/projects/${suite.projectId}/fields`;
    const notSelect = await request("editor", path, {
      method: "POST",
      body: JSON.stringify({
        kind: "track",
        name: uniqueName("Tempo"),
        type: "number",
        options: [{ label: "x" }],
      }),
    });
    expect(notSelect.status).toBe(400);

    const duplicate = await request("editor", path, {
      method: "POST",
      body: JSON.stringify({
        kind: "track",
        name: uniqueName("Dup"),
        type: "select",
        options: [{ label: "A" }, { label: "A" }],
      }),
    });
    expect(duplicate.status).toBe(400);

    const field = await mkField({
      kind: "track",
      name: uniqueName("Picks"),
      type: "select",
      options: [{ label: "A" }],
    });
    const unknownId = await request("editor", `${path}/${field.id}`, {
      method: "PATCH",
      body: JSON.stringify({ options: [{ id: "nope", label: "A" }] }),
    });
    expect(unknownId.status).toBe(400);
  });

  it("renames a field, and answers 409 for a name its kind already has", async () => {
    requireProject();
    const taken = await mkField({
      kind: "track",
      name: uniqueName("Taken"),
      type: "text",
    });
    const field = await mkField({
      kind: "track",
      name: uniqueName("Rename me"),
      type: "text",
    });
    // The same name on the other kind is a different field.
    await mkField({ kind: "collection", name: taken.name, type: "text" });

    const path = `/projects/${suite.projectId}/fields/${field.id}`;
    const clash = await request("editor", path, {
      method: "PATCH",
      body: JSON.stringify({ name: taken.name }),
    });
    expect(clash.status).toBe(409);

    const createClash = await request(
      "editor",
      `/projects/${suite.projectId}/fields`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "track", name: taken.name, type: "url" }),
      }
    );
    expect(createClash.status).toBe(409);

    const renamed = await request("editor", path, {
      method: "PATCH",
      body: JSON.stringify({ name: uniqueName("Renamed") }),
    });
    expect(renamed.status).toBe(200);
  });

  it("keeps a field's type fixed: a patch naming a type is refused", async () => {
    requireProject();
    const field = await mkField({
      kind: "track",
      name: uniqueName("Fixed"),
      type: "number",
    });
    const res = await request(
      "editor",
      `/projects/${suite.projectId}/fields/${field.id}`,
      { method: "PATCH", body: JSON.stringify({ type: "text" }) }
    );
    expect(res.status).toBe(400);

    const [after] = (await listFields("track")).filter(
      (f) => f.id === field.id
    );
    expect(after!.type).toBe("number");
  });

  it("reorders a kind's fields, refusing a list that leaves one out or names a foreign field", async () => {
    requireProject();
    const other = await throwawayProject("Fields order");
    const created = await suite.requestAs(
      other.editor,
      `/projects/${other.id}/fields`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "track", name: "Foreign", type: "text" }),
      }
    );
    expect(created.status).toBe(201);
    const foreign = (await created.json()) as Field;

    await mkField({ kind: "track", name: uniqueName("Order"), type: "text" });
    const before = await listFields("track");
    const reversed = before.map((field) => field.id).reverse();
    const path = `/projects/${suite.projectId}/fields/order`;

    const missing = await request("editor", path, {
      method: "PUT",
      body: JSON.stringify({ ids: reversed.slice(1) }),
    });
    expect(missing.status).toBe(400);

    const foreignRes = await request("editor", path, {
      method: "PUT",
      body: JSON.stringify({ ids: [...reversed, foreign.id] }),
    });
    expect(foreignRes.status).toBe(404);

    const res = await request("editor", path, {
      method: "PUT",
      body: JSON.stringify({ ids: reversed }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Field[]).map((f) => f.id)).toEqual(reversed);
    expect((await listFields("track")).map((f) => f.id)).toEqual(reversed);
  });

  it("counts a select's values per option, omitting unheld options and other types", async () => {
    requireProject();
    const select = await mkField({
      kind: "track",
      name: uniqueName("Mood"),
      type: "select",
      options: [{ label: "Calm" }, { label: "Loud" }, { label: "Unused" }],
    });
    const text = await mkField({
      kind: "track",
      name: uniqueName("Note"),
      type: "text",
    });
    const [calm, loud] = select.options;
    const tracks = [
      await mkTrack("Opt A"),
      await mkTrack("Opt B"),
      await mkTrack("Opt C"),
    ];
    await db.insert(customFieldValues).values([
      { fieldId: select.id, trackId: tracks[0]!, optionValue: calm!.id },
      { fieldId: select.id, trackId: tracks[1]!, optionValue: calm!.id },
      { fieldId: select.id, trackId: tracks[2]!, optionValue: loud!.id },
      { fieldId: text.id, trackId: tracks[0]!, textValue: "hi" },
    ]);

    const listed = await listFields("track");
    const listedSelect = listed.find((f) => f.id === select.id)!;
    expect(listedSelect.valueCount).toBe(3);
    expect(listedSelect.optionCounts).toEqual({
      [calm!.id]: 2,
      [loud!.id]: 1,
    });
    const listedText = listed.find((f) => f.id === text.id)!;
    expect(listedText.valueCount).toBe(1);
    expect(listedText.optionCounts).toBeUndefined();
  });

  it("gives a select nobody uses an empty optionCounts", async () => {
    requireProject();
    const select = await mkField({
      kind: "collection",
      name: uniqueName("Empty"),
      type: "select",
      options: [{ label: "Only" }],
    });
    const listed = (await listFields("collection")).find(
      (f) => f.id === select.id
    );
    expect(listed!.optionCounts).toEqual({});
  });

  it("deletes a field and cascades its values, counting them first", async () => {
    requireProject();
    const field = await mkField({
      kind: "track",
      name: uniqueName("Doomed"),
      type: "text",
    });
    const trackId = await mkTrack("Cascade");
    await db
      .insert(customFieldValues)
      .values({ fieldId: field.id, trackId, textValue: "kept until delete" });

    const listed = (await listFields("track")).find((f) => f.id === field.id);
    expect(listed!.valueCount).toBe(1);

    const path = `/projects/${suite.projectId}/fields/${field.id}`;
    await expectAccess("DELETE", path, { viewer: 403 });
    const res = await request("editor", path, { method: "DELETE" });
    expect(res.status).toBe(204);

    const left = await db
      .select()
      .from(customFieldValues)
      .where(eq(customFieldValues.fieldId, field.id));
    expect(left).toHaveLength(0);

    const again = await request("editor", path, { method: "DELETE" });
    expect(again.status).toBe(404);
  });

  it("answers 404 for a field of another project", async () => {
    requireProject();
    const other = await throwawayProject("Fields foreign");
    const res = await suite.requestAs(
      other.editor,
      `/projects/${other.id}/fields`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "track", name: "Theirs", type: "text" }),
      }
    );
    const theirs = (await res.json()) as Field;

    const patch = await request(
      "editor",
      `/projects/${suite.projectId}/fields/${theirs.id}`,
      { method: "PATCH", body: JSON.stringify({ name: "Mine now" }) }
    );
    expect(patch.status).toBe(404);
  });
});
