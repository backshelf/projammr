import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "bun:test";
import { db } from "../index.js";
import { trackRelationTypes } from "../schema/track-relation-types.js";
import { type Actor, setupSuite } from "../../test/fixtures.js";
import { DEFAULT_RELATION_TYPES } from "./track-relation-types.js";

const suite = setupSuite("Relation types");
const { owner, requireProject, request, requestAs, expectAccess } = suite;
const { throwawayProject } = suite;

type Entry = { id: number; name: string; rank: number; inUse: number };

/** A project's relation types as its listing answers them, in list order. */
async function typesOf(
  projectId = suite.projectId,
  as: Actor = owner
): Promise<Entry[]> {
  const res = await requestAs(as, `/projects/${projectId}/relation-types`);
  expect(res.status).toBe(200);
  return res.json();
}

/** A project's type ids, by name. */
async function typeIds(
  projectId = suite.projectId,
  as: Actor = owner
): Promise<Record<string, number>> {
  const types = await typesOf(projectId, as);
  return Object.fromEntries(types.map((type) => [type.name, type.id]));
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

describe("a project's relation types", () => {
  it("starts every new project on the eight kinds of relation, in order and unused", async () => {
    requireProject();
    const types = await typesOf();

    expect(
      types.map(({ name, rank, inUse }) => ({ name, rank, inUse }))
    ).toEqual(
      DEFAULT_RELATION_TYPES.map((name, rank) => ({ name, rank, inUse: 0 }))
    );
    expect([...DEFAULT_RELATION_TYPES]).toEqual([
      "remix",
      "remaster",
      "rework",
      "edit",
      "live version",
      "cover",
      "instrumental",
      "acoustic",
    ]);
  });

  it("lets any member read the list and only an editor change it", async () => {
    requireProject();
    const types = await typeIds();
    const base = `/projects/${suite.projectId}/relation-types`;

    await expectAccess("GET", base, { viewer: 200 });
    await expectAccess(
      "POST",
      base,
      { viewer: 403, editor: 201 },
      { name: "gate check" }
    );
    await expectAccess(
      "PATCH",
      `${base}/${types.cover}`,
      { viewer: 403 },
      { name: "cover version" }
    );
    await expectAccess(
      "PUT",
      `${base}/order`,
      { viewer: 403 },
      { ids: Object.values(types) }
    );
    await expectAccess("DELETE", `${base}/${types.acoustic}`, { viewer: 403 });
  });

  it("refuses a type of another project on its routes with a 404", async () => {
    requireProject();
    const elsewhere = await throwawayProject("Relation Type Foreign Route");
    const foreign = await typeIds(elsewhere.id, elsewhere.owner);
    const base = `/projects/${suite.projectId}/relation-types`;

    const rename = await request("owner", `${base}/${foreign.remix}`, {
      method: "PATCH",
      ...json({ name: "stolen" }),
    });
    expect(rename.status).toBe(404);
    const remove = await request("owner", `${base}/${foreign.remix}`, {
      method: "DELETE",
    });
    expect(remove.status).toBe(404);

    expect((await typeIds(elsewhere.id, elsewhere.owner)).remix).toBe(
      foreign.remix!
    );
  });
});

describe("editing the list", () => {
  let project: Awaited<ReturnType<typeof throwawayProject>>;
  const base = () => `/projects/${project.id}/relation-types`;
  const asOwner = (path: string, init: RequestInit = {}) =>
    requestAs(project.owner, path, init);

  beforeAll(async () => {
    if (suite.setUpFailed) return;
    project = await throwawayProject("Relation Type Editing");
  });

  it("adds a type at the end of the list", async () => {
    requireProject();
    const res = await asOwner(base(), {
      method: "POST",
      ...json({ name: "  sampled in  " }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Omit<Entry, "inUse">;
    expect(created).toEqual({
      id: created.id,
      name: "sampled in",
      rank: DEFAULT_RELATION_TYPES.length,
    });

    const types = await typesOf(project.id, project.owner);
    expect(types.at(-1)).toEqual({ ...created, inUse: 0 });
  });

  it("answers a name the list already has with a 409, on create and on rename", async () => {
    requireProject();
    const types = await typeIds(project.id, project.owner);

    const create = await asOwner(base(), {
      method: "POST",
      ...json({ name: "remix" }),
    });
    expect(create.status).toBe(409);
    expect(await create.json()).toMatchObject({
      error: "A relation type with that name already exists",
    });

    const rename = await asOwner(`${base()}/${types.edit}`, {
      method: "PATCH",
      ...json({ name: "rework" }),
    });
    expect(rename.status).toBe(409);
    expect((await typeIds(project.id, project.owner)).edit).toBe(types.edit!);
  });

  it("refuses a blank name", async () => {
    requireProject();
    const types = await typeIds(project.id, project.owner);
    const create = await asOwner(base(), {
      method: "POST",
      ...json({ name: "   " }),
    });
    expect(create.status).toBe(400);
    const rename = await asOwner(`${base()}/${types.edit}`, {
      method: "PATCH",
      ...json({}),
    });
    expect(rename.status).toBe(400);
  });

  it("renames a type in place", async () => {
    requireProject();
    const before = await typesOf(project.id, project.owner);
    const acoustic = before.find((type) => type.name === "acoustic")!;

    const res = await asOwner(`${base()}/${acoustic.id}`, {
      method: "PATCH",
      ...json({ name: "unplugged version" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: acoustic.id,
      name: "unplugged version",
      rank: acoustic.rank,
    });
  });

  it("reorders the list, and refuses an order that is not every type once", async () => {
    requireProject();
    const before = await typesOf(project.id, project.owner);
    const reversed = before.map((type) => type.id).reverse();

    const res = await asOwner(`${base()}/order`, {
      method: "PUT",
      ...json({ ids: reversed }),
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Entry[];
    expect(after.map((type) => type.id)).toEqual(reversed);
    expect(after.map((type) => type.rank)).toEqual(
      reversed.map((_, rank) => rank)
    );

    const elsewhere = await typeIds();
    for (const ids of [
      reversed.slice(1),
      [...reversed, reversed[0]!],
      [...reversed.slice(1), elsewhere.remix!],
    ]) {
      const refused = await asOwner(`${base()}/order`, {
        method: "PUT",
        ...json({ ids }),
      });
      expect(refused.status).toBe(400);
    }
    expect(
      (await typesOf(project.id, project.owner)).map((type) => type.id)
    ).toEqual(reversed);
  });

  it("appends after the last type once the list is reordered", async () => {
    requireProject();
    const res = await asOwner(base(), {
      method: "POST",
      ...json({ name: "interpolated in" }),
    });
    expect(res.status).toBe(201);
    const types = await typesOf(project.id, project.owner);
    expect(types.at(-1)?.name).toBe("interpolated in");
  });

  it("refuses to delete a type while relations use it, saying how many", async () => {
    requireProject();
    const types = await typeIds(project.id, project.owner);
    const track = async (title: string) => {
      const res = await asOwner("/tracks", {
        method: "POST",
        ...json({ title, artists: [], projectId: project.id }),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: number }).id;
    };
    const source = await track("In Use Source");
    const relationIds: number[] = [];
    for (const title of ["In Use One", "In Use Two"]) {
      const res = await asOwner(`/tracks/${await track(title)}/relations`, {
        method: "POST",
        ...json({ toTrackId: source, relationTypeId: types.remaster }),
      });
      expect(res.status).toBe(201);
      relationIds.push(((await res.json()) as { id: number }).id);
    }
    expect(
      (await typesOf(project.id, project.owner)).find(
        (type) => type.id === types.remaster
      )?.inUse
    ).toBe(2);

    const refused = await asOwner(`${base()}/${types.remaster}`, {
      method: "DELETE",
    });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({
      error: "2 relations use this type",
      code: "relation_type_in_use",
      details: { inUse: 2 },
    });

    await asOwner(`/tracks/${source}/relations/${relationIds[0]}`, {
      method: "DELETE",
    });
    const once = await asOwner(`${base()}/${types.remaster}`, {
      method: "DELETE",
    });
    expect(once.status).toBe(409);
    expect(await once.json()).toMatchObject({
      error: "1 relation uses this type",
      details: { inUse: 1 },
    });

    await asOwner(`/tracks/${source}/relations/${relationIds[1]}`, {
      method: "DELETE",
    });
    const freed = await asOwner(`${base()}/${types.remaster}`, {
      method: "DELETE",
    });
    expect(freed.status).toBe(204);
  });

  it("deletes a type no relation uses", async () => {
    requireProject();
    const types = await typeIds(project.id, project.owner);

    const res = await asOwner(`${base()}/${types.instrumental}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    expect(
      (await typesOf(project.id, project.owner)).map((type) => type.name)
    ).not.toContain("instrumental");

    const again = await asOwner(`${base()}/${types.instrumental}`, {
      method: "DELETE",
    });
    expect(again.status).toBe(404);
  });
});

describe("deleting a project", () => {
  it("takes its relation types with it, relations that use them included", async () => {
    requireProject();
    const doomed = await throwawayProject("Relation Type Project Delete");
    const types = await typeIds(doomed.id, doomed.owner);
    const track = async (title: string) =>
      (
        (await (
          await requestAs(doomed.owner, "/tracks", {
            method: "POST",
            ...json({ title, artists: [], projectId: doomed.id }),
          })
        ).json()) as { id: number }
      ).id;
    const from = await track("Gone Version");
    const to = await track("Gone Source");
    const related = await requestAs(doomed.owner, `/tracks/${from}/relations`, {
      method: "POST",
      ...json({ toTrackId: to, relationTypeId: types.cover }),
    });
    expect(related.status).toBe(201);

    const res = await requestAs(doomed.owner, `/projects/${doomed.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    const left = await db
      .select({ id: trackRelationTypes.id })
      .from(trackRelationTypes)
      .where(eq(trackRelationTypes.projectId, doomed.id));
    expect(left).toEqual([]);
  });
});
