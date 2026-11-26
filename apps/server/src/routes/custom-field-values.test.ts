import { beforeAll, describe, expect, it } from "bun:test";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { activity } from "../db/schema/activity.js";
import { customFieldValues } from "../db/schema/custom-fields.js";
import { setupSuite } from "../test/fixtures.js";

const suite = setupSuite("Custom field values");
const { requireProject, request, mkTrack, mkCollection, throwawayProject } =
  suite;

type Field = {
  id: number;
  name: string;
  options: { id: string; label: string }[];
};
type Row = { id: number; title: string; fields: Record<string, unknown> };
type Page = {
  rows: Row[];
  facets: Record<string, Record<string, number>>;
  groups: { key: string; label: string; count: number }[];
};

const key = (field: { id: number }) => `cf_${field.id}`;

async function mkField(body: Record<string, unknown>): Promise<Field> {
  const res = await request("editor", `/projects/${suite.projectId}/fields`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Field;
}

async function patchTrack(id: number, body: Record<string, unknown>) {
  return request("editor", `/tracks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

async function setFields(id: number, fields: Record<string, unknown>) {
  const res = await patchTrack(id, { fields });
  expect(res.status).toBe(200);
}

async function trackPage(params: Record<string, string>): Promise<Page> {
  const query = new URLSearchParams(params).toString();
  const res = await request(
    "viewer",
    `/projects/${suite.projectId}/tracks/paginated?${query}`
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
}

/** The fixture's own tracks, named "List …", in the order a page returns them. */
async function listTitles(params: Record<string, string> = {}) {
  const page = await trackPage({ q: "List", ...params });
  return page.rows.map((row) => row.title);
}

async function lastActivity(entityId: number) {
  const [row] = await db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.entityType, "track"),
        eq(activity.entityId, entityId),
        eq(activity.action, "updated")
      )
    )
    .orderBy(desc(activity.id))
    .limit(1);
  return row;
}

describe("custom field values on tracks", () => {
  const f = {} as Record<
    "engineer" | "tempo" | "mastered" | "released" | "mood" | "link",
    Field
  >;
  const t = {} as Record<"a" | "b" | "c" | "d", number>;
  const mood = {} as Record<"happy" | "sad" | "calm", string>;

  beforeAll(async () => {
    if (suite.setUpFailed) return;
    f.engineer = await mkField({
      kind: "track",
      name: "Engineer",
      type: "text",
    });
    f.tempo = await mkField({ kind: "track", name: "Tempo", type: "number" });
    f.mastered = await mkField({
      kind: "track",
      name: "Mastered",
      type: "date",
    });
    f.released = await mkField({
      kind: "track",
      name: "Released",
      type: "checkbox",
    });
    f.mood = await mkField({
      kind: "track",
      name: "Mood",
      type: "select",
      options: [{ label: "Happy" }, { label: "Sad" }, { label: "Calm" }],
    });
    f.link = await mkField({ kind: "track", name: "Link", type: "url" });
    [mood.happy, mood.sad, mood.calm] = f.mood.options.map((o) => o.id) as [
      string,
      string,
      string,
    ];

    t.a = await mkTrack("List A");
    t.b = await mkTrack("List B");
    t.c = await mkTrack("List C");
    t.d = await mkTrack("List D");
    await setFields(t.a, {
      [key(f.engineer)]: "beta one",
      [key(f.tempo)]: 120,
      [key(f.mastered)]: "2024-01-10",
      [key(f.released)]: true,
      [key(f.mood)]: mood.happy,
      [key(f.link)]: "https://a.example/track",
    });
    await setFields(t.b, {
      [key(f.engineer)]: "alpha two",
      [key(f.tempo)]: "90",
      [key(f.mastered)]: "2024-03-05",
      [key(f.released)]: false,
      // A select takes an option's exact label as well as its id.
      [key(f.mood)]: "Sad",
    });
    await setFields(t.c, {
      [key(f.tempo)]: 140.5,
      [key(f.released)]: true,
      [key(f.mood)]: mood.calm,
      [key(f.link)]: "https://c.example",
    });
  });

  describe("the fields bag", () => {
    it("carries typed values on the detail and on list rows, and nothing for an unset field", async () => {
      requireProject();
      const res = await request("viewer", `/tracks/${t.a}`);
      expect(res.status).toBe(200);
      expect((await res.json()).fields).toEqual({
        [key(f.engineer)]: "beta one",
        [key(f.tempo)]: 120,
        [key(f.mastered)]: "2024-01-10",
        [key(f.released)]: true,
        [key(f.mood)]: mood.happy,
        [key(f.link)]: "https://a.example/track",
      });

      const page = await trackPage({ q: "List" });
      const byTitle = new Map(page.rows.map((row) => [row.title, row]));
      expect(byTitle.get("List B")!.fields).toEqual({
        [key(f.engineer)]: "alpha two",
        [key(f.tempo)]: 90,
        [key(f.mastered)]: "2024-03-05",
        [key(f.released)]: false,
        [key(f.mood)]: mood.sad,
      });
      expect(byTitle.get("List D")!.fields).toEqual({});
    });
  });

  describe("filters", () => {
    it("filters a number by range, with either end open", async () => {
      requireProject();
      const tempo = key(f.tempo);
      expect(await listTitles({ [tempo]: "100..", sort: "id" })).toEqual([
        "List A",
        "List C",
      ]);
      expect(await listTitles({ [tempo]: "..100" })).toEqual(["List B"]);
      expect(await listTitles({ [tempo]: "90..120", sort: "id" })).toEqual([
        "List A",
        "List B",
      ]);
    });

    it("treats a range with both ends empty as no filter, and one with from above to as empty", async () => {
      requireProject();
      const tempo = key(f.tempo);
      expect(await listTitles({ [tempo]: ".." })).toHaveLength(4);
      expect(await listTitles({ [tempo]: "200..100" })).toEqual([]);
      // An end that does not parse leaves the list unfiltered.
      expect(await listTitles({ [tempo]: "abc.." })).toHaveLength(4);
    });

    it("filters a date by range", async () => {
      requireProject();
      const mastered = key(f.mastered);
      expect(await listTitles({ [mastered]: "2024-02-01.." })).toEqual([
        "List B",
      ]);
      expect(await listTitles({ [mastered]: "..2024-02-01" })).toEqual([
        "List A",
      ]);
    });

    it("filters a select by membership, and an option the field lacks matches nothing", async () => {
      requireProject();
      const moodKey = key(f.mood);
      expect(
        await listTitles({
          [moodKey]: `${mood.happy},${mood.calm}`,
          sort: "id",
        })
      ).toEqual(["List A", "List C"]);
      expect(await listTitles({ [moodKey]: "nosuch" })).toEqual([]);
    });

    it("filters a checkbox by each of its three states", async () => {
      requireProject();
      const released = key(f.released);
      expect(await listTitles({ [released]: "true", sort: "id" })).toEqual([
        "List A",
        "List C",
      ]);
      expect(await listTitles({ [released]: "false" })).toEqual(["List B"]);
      expect(await listTitles({ [released]: "unset" })).toEqual(["List D"]);
    });

    it("filters a url by presence", async () => {
      requireProject();
      const link = key(f.link);
      expect(await listTitles({ [link]: "set", sort: "id" })).toEqual([
        "List A",
        "List C",
      ]);
      expect(await listTitles({ [link]: "unset", sort: "id" })).toEqual([
        "List B",
        "List D",
      ]);
    });

    it("filters text by contains, case-insensitively, with LIKE wildcards taken literally", async () => {
      requireProject();
      const engineer = key(f.engineer);
      expect(await listTitles({ [engineer]: "ALPHA" })).toEqual(["List B"]);
      expect(await listTitles({ [engineer]: "%" })).toEqual([]);
    });

    it("ignores a key naming another project's field, as an unknown key", async () => {
      requireProject();
      const other = await throwawayProject("Values foreign");
      const res = await suite.requestAs(
        other.editor,
        `/projects/${other.id}/fields`,
        {
          method: "POST",
          body: JSON.stringify({ kind: "track", name: "Far", type: "number" }),
        }
      );
      const foreign = (await res.json()) as Field;
      expect(
        await listTitles({ [key(foreign)]: "1..2", sort: `${key(foreign)}` })
      ).toHaveLength(4);
    });
  });

  describe("sort", () => {
    it("sorts by a number either way, with unset rows last", async () => {
      requireProject();
      const tempo = key(f.tempo);
      expect(await listTitles({ sort: `${tempo}.asc` })).toEqual([
        "List B",
        "List A",
        "List C",
        "List D",
      ]);
      expect(await listTitles({ sort: `${tempo}.desc` })).toEqual([
        "List C",
        "List A",
        "List B",
        "List D",
      ]);
    });

    it("sorts by text, date, checkbox and url values", async () => {
      requireProject();
      expect(await listTitles({ sort: `${key(f.engineer)}.asc` })).toEqual([
        "List B",
        "List A",
        "List C",
        "List D",
      ]);
      expect(await listTitles({ sort: `${key(f.mastered)}.desc` })).toEqual([
        "List B",
        "List A",
        "List C",
        "List D",
      ]);
      expect(await listTitles({ sort: `${key(f.released)}.asc` })).toEqual([
        "List B",
        "List A",
        "List C",
        "List D",
      ]);
      expect(await listTitles({ sort: `${key(f.link)}.desc` })).toEqual([
        "List C",
        "List A",
        "List B",
        "List D",
      ]);
    });

    it("sorts a select by the field's option order, not the ids' spelling", async () => {
      requireProject();
      expect(await listTitles({ sort: `${key(f.mood)}.asc` })).toEqual([
        "List A",
        "List B",
        "List C",
        "List D",
      ]);
      expect(await listTitles({ sort: `${key(f.mood)}.desc` })).toEqual([
        "List C",
        "List B",
        "List A",
        "List D",
      ]);
    });
  });

  describe("grouping", () => {
    it("groups by a select in option order, labelled by option, unset rows last", async () => {
      requireProject();
      const page = await trackPage({ q: "List", groupBy: key(f.mood) });
      expect(page.groups).toEqual([
        { key: mood.happy, label: "Happy", count: 1 },
        { key: mood.sad, label: "Sad", count: 1 },
        { key: mood.calm, label: "Calm", count: 1 },
        { key: "__none__", label: "Not set", count: 1 },
      ]);
      expect(page.rows.map((row) => row.title)).toEqual([
        "List A",
        "List B",
        "List C",
        "List D",
      ]);
    });

    it("groups by a checkbox: checked, unchecked, then unset", async () => {
      requireProject();
      const page = await trackPage({ q: "List", groupBy: key(f.released) });
      expect(page.groups).toEqual([
        { key: "true", label: "Yes", count: 2 },
        { key: "false", label: "No", count: 1 },
        { key: "__none__", label: "Not set", count: 1 },
      ]);
    });

    it("sorts inside a field grouping by another field", async () => {
      requireProject();
      const page = await trackPage({
        q: "List",
        groupBy: key(f.released),
        sort: `${key(f.tempo)}.desc`,
      });
      expect(page.rows.map((row) => row.title)).toEqual([
        "List C",
        "List A",
        "List B",
        "List D",
      ]);
    });

    it("sorts a many-to-many grouping by a field, and a field grouping by its own field", async () => {
      requireProject();
      const byLabel = await trackPage({
        q: "List",
        groupBy: "label",
        sort: `${key(f.tempo)}.asc`,
      });
      expect(byLabel.rows.map((row) => row.title)).toEqual([
        "List B",
        "List A",
        "List C",
        "List D",
      ]);

      const own = await trackPage({
        q: "List",
        groupBy: key(f.mood),
        sort: `${key(f.mood)}.desc`,
      });
      expect(own.groups.map((group) => group.label)).toEqual([
        "Happy",
        "Sad",
        "Calm",
        "Not set",
      ]);
    });

    it("does not group by a type that has no grouping", async () => {
      requireProject();
      const page = await trackPage({ q: "List", groupBy: key(f.engineer) });
      expect(page.groups).toEqual([]);
    });
  });

  describe("facets", () => {
    it("counts a select's options under its key, applying every other filter but its own", async () => {
      requireProject();
      const moodKey = key(f.mood);
      const all = await trackPage({ q: "List" });
      expect(all.facets[moodKey]).toEqual({
        [mood.happy]: 1,
        [mood.sad]: 1,
        [mood.calm]: 1,
      });

      const released = await trackPage({
        q: "List",
        [key(f.released)]: "true",
      });
      expect(released.facets[moodKey]).toEqual({
        [mood.happy]: 1,
        [mood.calm]: 1,
      });

      const own = await trackPage({ q: "List", [moodKey]: mood.happy });
      expect(own.rows).toHaveLength(1);
      expect(own.facets[moodKey]).toEqual(all.facets[moodKey]!);
      // A built-in facet applies the field filter.
      expect(all.facets.explicit).toEqual({ false: 4 });
      expect(own.facets.explicit).toEqual({ false: 1 });
    });

    it("gives only select fields a facet", async () => {
      requireProject();
      const page = await trackPage({ q: "List" });
      expect(page.facets[key(f.tempo)]).toBeUndefined();
      expect(page.facets[key(f.released)]).toBeUndefined();
    });
  });

  describe("a removed option", () => {
    it("keeps the raw id on its rows, groups under it and matches no filter", async () => {
      requireProject();
      const genre = await mkField({
        kind: "track",
        name: "Genre",
        type: "select",
        options: [{ label: "Rock" }, { label: "Pop" }],
      });
      const [rock, pop] = genre.options as [
        Field["options"][0],
        Field["options"][0],
      ];
      const track = await mkTrack("Removed option");
      await setFields(track, { [key(genre)]: pop.id });

      const edit = await request(
        "editor",
        `/projects/${suite.projectId}/fields/${genre.id}`,
        { method: "PATCH", body: JSON.stringify({ options: [rock] }) }
      );
      expect(edit.status).toBe(200);

      const page = await trackPage({
        q: "Removed option",
        groupBy: key(genre),
      });
      expect(page.rows[0]!.fields[key(genre)]).toBe(pop.id);
      expect(page.groups).toEqual([{ key: pop.id, label: pop.id, count: 1 }]);

      const filtered = await trackPage({
        q: "Removed option",
        [key(genre)]: pop.id,
      });
      expect(filtered.rows).toEqual([]);
    });
  });

  describe("writes", () => {
    it("records a patched value in the track's activity as a cf_<id> change, and clears with null", async () => {
      requireProject();
      const track = await mkTrack("Activity");
      const tempo = key(f.tempo);

      const res = await patchTrack(track, {
        title: "Activity renamed",
        fields: { [tempo]: 101 },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.title).toBe("Activity renamed");
      expect(body.fields).toEqual({ [tempo]: 101 });
      expect((await lastActivity(track))!.changes).toEqual({
        title: { from: "Activity", to: "Activity renamed" },
        [tempo]: { from: null, to: 101 },
      });

      const cleared = await patchTrack(track, { fields: { [tempo]: null } });
      expect(cleared.status).toBe(200);
      expect((await cleared.json()).fields).toEqual({});
      expect((await lastActivity(track))!.changes).toEqual({
        [tempo]: { from: 101, to: null },
      });
      const rows = await db
        .select()
        .from(customFieldValues)
        .where(eq(customFieldValues.trackId, track));
      expect(rows).toEqual([]);
    });

    it("answers 400 naming the field for a value of the wrong type, and writes nothing", async () => {
      requireProject();
      const track = await mkTrack("Wrong type");
      const res = await patchTrack(track, {
        title: "Should not land",
        fields: { [key(f.tempo)]: "abc" },
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toMatchObject({
        field: key(f.tempo),
        name: "Tempo",
      });

      const bad = [
        { [key(f.mastered)]: "2024-02-30" },
        { [key(f.released)]: "maybe" },
        { [key(f.mood)]: "Ecstatic" },
        { [key(f.link)]: "not a url" },
        { [key(f.link)]: "javascript:alert(1)" },
        { [key(f.link)]: "data:text/html,x" },
      ];
      for (const fields of bad) {
        expect((await patchTrack(track, { fields })).status).toBe(400);
      }

      const detail = await (await request("viewer", `/tracks/${track}`)).json();
      expect(detail.title).toBe("Wrong type");
      expect(detail.fields).toEqual({});
    });

    it("answers 400 for a key naming no field of the project, another project's included", async () => {
      requireProject();
      const track = await mkTrack("Unknown key");
      expect(
        (await patchTrack(track, { fields: { cf_999999: 1 } })).status
      ).toBe(400);

      const other = await throwawayProject("Values write foreign");
      const res = await suite.requestAs(
        other.editor,
        `/projects/${other.id}/fields`,
        {
          method: "POST",
          body: JSON.stringify({ kind: "track", name: "Theirs", type: "text" }),
        }
      );
      const foreign = (await res.json()) as Field;
      const write = await patchTrack(track, {
        fields: { [key(foreign)]: "x" },
      });
      expect(write.status).toBe(400);
      expect((await write.json()).details).toEqual({ field: key(foreign) });

      // A collection field is not a track field.
      const collectionField = await mkField({
        kind: "collection",
        name: "Only collections",
        type: "text",
      });
      expect(
        (
          await patchTrack(track, {
            fields: { [key(collectionField)]: "x" },
          })
        ).status
      ).toBe(400);
    });

    it("refuses a viewer's value write", async () => {
      requireProject();
      const res = await request("viewer", `/tracks/${t.d}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { [key(f.tempo)]: 1 } }),
      });
      expect(res.status).toBe(403);
    });

    it("creates a track with values, and refuses the create when one does not fit", async () => {
      requireProject();
      const res = await request("editor", "/tracks", {
        method: "POST",
        body: JSON.stringify({
          title: "Created with fields",
          artists: [],
          projectId: suite.projectId,
          fields: { [key(f.tempo)]: 77, [key(f.mood)]: mood.sad },
        }),
      });
      expect(res.status).toBe(201);
      const created = await res.json();
      expect(created.fields).toEqual({
        [key(f.tempo)]: 77,
        [key(f.mood)]: mood.sad,
      });

      const refused = await request("editor", "/tracks", {
        method: "POST",
        body: JSON.stringify({
          title: "Refused create",
          artists: [],
          projectId: suite.projectId,
          fields: { [key(f.tempo)]: "fast" },
        }),
      });
      expect(refused.status).toBe(400);
      const page = await trackPage({ q: "Refused create" });
      expect(page.rows).toEqual([]);
    });

    it("bulk-sets a value by ids and by a selection filtered on a field, recording each row", async () => {
      requireProject();
      const batch = await mkField({
        kind: "track",
        name: "Batch",
        type: "number",
      });
      const e = await mkTrack("Bulk E");
      const g = await mkTrack("Bulk G");

      const byIds = await request("editor", "/tracks/bulk", {
        method: "PATCH",
        body: JSON.stringify({
          projectId: suite.projectId,
          selection: { ids: [e, g] },
          patch: { fields: { [key(batch)]: 5 } },
        }),
      });
      expect(byIds.status).toBe(200);
      expect(await byIds.json()).toEqual({ updated: 2 });
      expect((await lastActivity(e))!.changes).toEqual({
        [key(batch)]: { from: null, to: 5 },
      });

      const byFilter = await request("editor", "/tracks/bulk", {
        method: "PATCH",
        body: JSON.stringify({
          projectId: suite.projectId,
          selection: { all: true, q: "List", [key(f.released)]: "true" },
          patch: { fields: { [key(batch)]: 9 } },
        }),
      });
      expect(byFilter.status).toBe(200);
      expect(await byFilter.json()).toEqual({ updated: 2 });
      const page = await trackPage({ q: "List", [key(batch)]: "9..9" });
      expect(page.rows.map((row) => row.title).sort()).toEqual([
        "List A",
        "List C",
      ]);

      const wrong = await request("editor", "/tracks/bulk", {
        method: "PATCH",
        body: JSON.stringify({
          projectId: suite.projectId,
          selection: { ids: [e] },
          patch: { fields: { [key(batch)]: "many" } },
        }),
      });
      expect(wrong.status).toBe(400);
    });
  });

  describe("saved views and deleted fields", () => {
    it("keeps a cf_ parameter in a saved view, which a list ignores once the field is gone", async () => {
      requireProject();
      const doomed = await mkField({
        kind: "track",
        name: "Doomed",
        type: "number",
      });
      const query = `q=List&${key(doomed)}=1..2&sort=${key(doomed)}.desc`;
      const saved = await request(
        "editor",
        `/projects/${suite.projectId}/saved-views`,
        {
          method: "POST",
          body: JSON.stringify({
            name: "With a field",
            kind: "track",
            config: { query },
          }),
        }
      );
      expect(saved.status).toBe(201);
      expect((await saved.json()).config.query).toBe(query);

      expect(await listTitles({ [key(doomed)]: "1..2" })).toEqual([]);
      const removed = await request(
        "editor",
        `/projects/${suite.projectId}/fields/${doomed.id}`,
        { method: "DELETE" }
      );
      expect(removed.status).toBe(204);
      expect(
        await listTitles({
          [key(doomed)]: "1..2",
          sort: `${key(doomed)}.desc`,
        })
      ).toHaveLength(4);
    });
  });
});

describe("moving entities that hold custom values", () => {
  /** A project the suite's editor is also an editor in, with a field of its own. */
  async function moveTarget(label: string) {
    const target = await throwawayProject(label);
    const invite = await suite.requestAs(
      target.owner,
      `/projects/${target.id}/invites`,
      {
        method: "POST",
        body: JSON.stringify({ email: suite.editor.email, role: "editor" }),
      }
    );
    const { token } = await invite.json();
    const accepted = await request("editor", `/invites/${token}/accept`, {
      method: "POST",
    });
    expect(accepted.status).toBe(200);
    const res = await suite.requestAs(
      target.editor,
      `/projects/${target.id}/fields`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "track", name: "Key", type: "text" }),
      }
    );
    expect(res.status).toBe(201);
    return { ...target, key: (await res.json()) as Field };
  }

  it("previews one track's move, then moves it, both naming what is dropped", async () => {
    requireProject();
    const target = await moveTarget("Move single");
    const keyField = await mkField({
      kind: "track",
      name: "Key",
      type: "text",
    });
    const lost = await mkField({
      kind: "track",
      name: "Lost on move",
      type: "number",
    });
    const track = await mkTrack("Moving one");
    await setFields(track, { [key(keyField)]: "F minor", [key(lost)]: 3 });

    const dropped = [
      {
        fieldId: lost.id,
        kind: "track",
        name: "Lost on move",
        type: "number",
        count: 1,
      },
    ];
    const preview = await request("editor", `/tracks/${track}/move/preview`, {
      method: "POST",
      body: JSON.stringify({ projectId: target.id }),
    });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ droppedFields: dropped });

    const viewerPreview = await request(
      "viewer",
      `/tracks/${track}/move/preview`,
      { method: "POST", body: JSON.stringify({ projectId: target.id }) }
    );
    expect(viewerPreview.status).toBe(403);

    const moved = await request("editor", `/tracks/${track}/move`, {
      method: "POST",
      body: JSON.stringify({ projectId: target.id }),
    });
    expect(moved.status).toBe(200);
    const body = await moved.json();
    expect(body.projectId).toBe(target.id);
    expect(body.droppedFields).toEqual(dropped);

    const detail = await (await request("editor", `/tracks/${track}`)).json();
    expect(detail.fields).toEqual({ [key(target.key)]: "F minor" });
  });

  it("previews and moves a bulk selection, answering the dropped values beside the count", async () => {
    requireProject();
    const target = await moveTarget("Move bulk");
    const lost = await mkField({
      kind: "track",
      name: "Bulk lost",
      type: "checkbox",
    });
    const first = await mkTrack("Bulk move one");
    const second = await mkTrack("Bulk move two");
    await setFields(first, { [key(lost)]: true });
    await setFields(second, { [key(lost)]: false });

    const body = {
      projectId: suite.projectId,
      selection: { ids: [first, second] },
      targetProjectId: target.id,
    };
    const dropped = [
      {
        fieldId: lost.id,
        kind: "track",
        name: "Bulk lost",
        type: "checkbox",
        count: 2,
      },
    ];
    const preview = await request("editor", "/tracks/bulk/move/preview", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ droppedFields: dropped });

    const moved = await request("editor", "/tracks/bulk/move", {
      method: "POST",
      body: JSON.stringify(body),
    });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toEqual({
      moved: 2,
      droppedFields: dropped,
      priorityFallbacks: [],
    });
  });

  it("previews nothing lost for a session", async () => {
    requireProject();
    const target = await moveTarget("Move session");
    const session = await suite.mkSession();
    const res = await request(
      "editor",
      `/sessions/${session.id}/move/preview`,
      {
        method: "POST",
        body: JSON.stringify({ projectId: target.id }),
      }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ droppedFields: [] });
  });

  it("refuses a preview into a project the caller cannot write to", async () => {
    requireProject();
    const other = await throwawayProject("Move refused");
    const track = await mkTrack("Not moving");
    const res = await request("editor", `/tracks/${track}/move/preview`, {
      method: "POST",
      body: JSON.stringify({ projectId: other.id }),
    });
    expect(res.status).toBe(403);
  });
});

describe("custom field values on collections", () => {
  it("carries the bag and filters, sorts, groups and facets a collection field", async () => {
    requireProject();
    const format = await mkField({
      kind: "collection",
      name: "Format",
      type: "select",
      options: [{ label: "Vinyl" }, { label: "CD" }],
    });
    const [vinyl, cd] = format.options.map((o) => o.id) as [string, string];
    const x = await mkCollection("Coll X");
    const y = await mkCollection("Coll Y");
    await mkCollection("Coll Z");

    for (const [id, value] of [
      [x, cd],
      [y, vinyl],
    ] as const) {
      const res = await request("editor", `/collections/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { [key(format)]: value } }),
      });
      expect(res.status).toBe(200);
    }

    const detail = await (await request("viewer", `/collections/${x}`)).json();
    expect(detail.fields).toEqual({ [key(format)]: cd });

    const pageOf = async (params: Record<string, string>) => {
      const res = await request(
        "viewer",
        `/projects/${suite.projectId}/collections/paginated?${new URLSearchParams(
          { q: "Coll", ...params }
        ).toString()}`
      );
      expect(res.status).toBe(200);
      return (await res.json()) as Page;
    };

    const sorted = await pageOf({ sort: `${key(format)}.asc` });
    expect(sorted.rows.map((row) => row.title)).toEqual([
      "Coll Y",
      "Coll X",
      "Coll Z",
    ]);
    expect(sorted.facets[key(format)]).toEqual({ [vinyl]: 1, [cd]: 1 });

    const filtered = await pageOf({ [key(format)]: cd });
    expect(filtered.rows.map((row) => row.title)).toEqual(["Coll X"]);

    const grouped = await pageOf({ groupBy: key(format) });
    expect(grouped.groups.map((group) => group.label)).toEqual([
      "Vinyl",
      "CD",
      "Not set",
    ]);

    const bulk = await request("editor", "/collections/bulk", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: suite.projectId,
        selection: { all: true, q: "Coll", [key(format)]: vinyl },
        patch: { fields: { [key(format)]: null } },
      }),
    });
    expect(bulk.status).toBe(200);
    expect((await pageOf({ [key(format)]: vinyl })).rows).toEqual([]);
  });
});
