import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "bun:test";
import { db } from "../index.js";
import { collections } from "../schema/collections.js";
import { priorityLevels } from "../schema/priority-levels.js";
import { sessions } from "../schema/sessions.js";
import { tracks } from "../schema/tracks.js";
import { type Actor, setupSuite } from "../../test/fixtures.js";

const suite = setupSuite("Priority levels");
const {
  owner,
  requireProject,
  request,
  requestAs,
  expectAccess,
  throwawayProject,
  mkTrack,
  mkCollection,
  mkSession,
} = suite;

type Level = {
  id: number;
  name: string;
  colour: string;
  rank: number;
  isDefault: boolean;
  counts: { tracks: number; collections: number; sessions: number };
};

type Page<T> = {
  rows: T[];
  facets: Record<string, Record<string, number>>;
  groups: { key: string; label: string; count: number }[];
};

/** A project's scale as its listing answers it, bottom level first. */
async function scaleOf(
  projectId = suite.projectId,
  as: Actor = owner
): Promise<Level[]> {
  const res = await requestAs(as, `/projects/${projectId}/priorities`);
  expect(res.status).toBe(200);
  return res.json();
}

/** A project's level ids, by name. */
async function levelIds(
  projectId = suite.projectId,
  as: Actor = owner
): Promise<Record<string, number>> {
  const scale = await scaleOf(projectId, as);
  return Object.fromEntries(scale.map((level) => [level.name, level.id]));
}

/** The level a row of one of the three tables holds. */
async function levelOf(
  table: typeof tracks | typeof collections | typeof sessions,
  id: number
): Promise<number | undefined> {
  const [row] = await db
    .select({ priorityId: table.priorityId })
    .from(table)
    .where(eq(table.id, id));
  return row?.priorityId;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

describe("a project's priority scale", () => {
  it("starts every new project on five levels, None the default at the bottom", async () => {
    requireProject();
    const scale = await scaleOf();

    expect(
      scale.map(({ name, colour, rank, isDefault }) => ({
        name,
        colour,
        rank,
        isDefault,
      }))
    ).toEqual([
      { name: "None", colour: "#6C7278", rank: 0, isDefault: true },
      { name: "Low", colour: "#0891C9", rank: 1, isDefault: false },
      { name: "Medium", colour: "#D6B529", rank: 2, isDefault: false },
      { name: "High", colour: "#F06B00", rank: 3, isDefault: false },
      { name: "Urgent", colour: "#D0183A", rank: 4, isDefault: false },
    ]);
  });

  it("lets any member read the scale and only an editor change it", async () => {
    requireProject();
    const levels = await levelIds();
    const base = `/projects/${suite.projectId}/priorities`;

    await expectAccess("GET", base, { viewer: 200 });
    await expectAccess(
      "POST",
      base,
      { viewer: 403, editor: 201 },
      { name: "Gate Check", colour: "#112233" }
    );
    await expectAccess(
      "PATCH",
      `${base}/${levels.Low}`,
      { viewer: 403 },
      { colour: "#445566" }
    );
    await expectAccess(
      "PUT",
      `${base}/order`,
      { viewer: 403 },
      { ids: Object.values(levels) }
    );
    await expectAccess(
      "DELETE",
      `${base}/${levels.Low}?replaceWith=${levels.None}`,
      { viewer: 403 }
    );
  });

  it("counts the tracks, collections and sessions each level holds", async () => {
    requireProject();
    const levels = await levelIds();
    const trackId = await mkTrack("Counted");
    await mkSession({ name: "Counted session", priorityId: levels.High });
    await request("owner", `/tracks/${trackId}`, {
      method: "PATCH",
      ...json({ priorityId: levels.High }),
    });

    const high = (await scaleOf()).find((level) => level.name === "High")!;
    expect(high.counts.tracks).toBeGreaterThanOrEqual(1);
    expect(high.counts.sessions).toBeGreaterThanOrEqual(1);
  });

  it("refuses a level of another project on its routes with a 404", async () => {
    requireProject();
    const elsewhere = await throwawayProject("Priority Foreign Route");
    const foreign = await levelIds(elsewhere.id, elsewhere.owner);

    const res = await request(
      "owner",
      `/projects/${suite.projectId}/priorities/${foreign.Low}`,
      { method: "PATCH", ...json({ name: "Stolen" }) }
    );
    expect(res.status).toBe(404);
    expect((await levelIds(elsewhere.id, elsewhere.owner)).Low).toBeDefined();
  });
});

describe("editing a scale", () => {
  let project: Awaited<ReturnType<typeof throwawayProject>>;
  const base = () => `/projects/${project.id}/priorities`;
  const asOwner = (path: string, init: RequestInit = {}) =>
    requestAs(project.owner, path, init);

  beforeAll(async () => {
    if (suite.setUpFailed) return;
    project = await throwawayProject("Priority Editing");
  });

  it("adds a level at the top of the scale", async () => {
    requireProject();
    const res = await asOwner(base(), {
      method: "POST",
      ...json({ name: "Release Week", colour: "#AA3366" }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Level;
    expect(created).toMatchObject({
      name: "Release Week",
      colour: "#AA3366",
      rank: 5,
      isDefault: false,
    });

    const scale = await scaleOf(project.id, project.owner);
    expect(scale.at(-1)?.id).toBe(created.id);
  });

  it("answers a name the scale already has with a 409, on create and on rename", async () => {
    requireProject();
    const levels = await levelIds(project.id, project.owner);

    const create = await asOwner(base(), {
      method: "POST",
      ...json({ name: "High", colour: "#123456" }),
    });
    expect(create.status).toBe(409);
    expect(await create.json()).toMatchObject({
      error: "A priority level with that name already exists",
    });

    const rename = await asOwner(`${base()}/${levels.Low}`, {
      method: "PATCH",
      ...json({ name: "Medium" }),
    });
    expect(rename.status).toBe(409);
    expect(await rename.json()).toMatchObject({
      error: "A priority level with that name already exists",
    });
  });

  it("refuses a colour that is not a hex colour", async () => {
    requireProject();
    const res = await asOwner(base(), {
      method: "POST",
      ...json({ name: "Muddy", colour: "brown" }),
    });
    expect(res.status).toBe(400);
  });

  it("renames and recolours a level", async () => {
    requireProject();
    const levels = await levelIds(project.id, project.owner);

    const res = await asOwner(`${base()}/${levels.Urgent}`, {
      method: "PATCH",
      ...json({ name: "Now", colour: "#FF0000" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: levels.Urgent,
      name: "Now",
      colour: "#FF0000",
      isDefault: false,
    });
  });

  it("refuses an empty patch and an isDefault of false", async () => {
    requireProject();
    const levels = await levelIds(project.id, project.owner);
    for (const body of [{}, { isDefault: false }]) {
      const res = await asOwner(`${base()}/${levels.None}`, {
        method: "PATCH",
        ...json(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it("moves the default flag, and new rows follow it", async () => {
    requireProject();
    const levels = await levelIds(project.id, project.owner);

    const res = await asOwner(`${base()}/${levels.Low}`, {
      method: "PATCH",
      ...json({ isDefault: true }),
    });
    expect(res.status).toBe(200);

    const scale = await scaleOf(project.id, project.owner);
    expect(scale.filter((level) => level.isDefault).map((l) => l.name)).toEqual(
      ["Low"]
    );

    const created = await asOwner("/tracks", {
      method: "POST",
      ...json({ title: "Follows Default", artists: [], projectId: project.id }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).priorityId).toBe(levels.Low);

    await asOwner(`${base()}/${levels.None}`, {
      method: "PATCH",
      ...json({ isDefault: true }),
    });
  });

  it("reorders the scale, and refuses an order that is not every level once", async () => {
    requireProject();
    const before = await scaleOf(project.id, project.owner);
    const reversed = before.map((level) => level.id).reverse();

    const res = await asOwner(`${base()}/order`, {
      method: "PUT",
      ...json({ ids: reversed }),
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as Level[];
    expect(after.map((level) => level.id)).toEqual(reversed);
    expect(after.map((level) => level.rank)).toEqual(
      reversed.map((_, rank) => rank)
    );

    const elsewhere = await levelIds();
    for (const ids of [
      reversed.slice(1),
      [...reversed, reversed[0]!],
      [...reversed.slice(1), elsewhere.None!],
    ]) {
      const refused = await asOwner(`${base()}/order`, {
        method: "PUT",
        ...json({ ids }),
      });
      expect(refused.status).toBe(400);
    }
    expect(
      (await scaleOf(project.id, project.owner)).map((level) => level.id)
    ).toEqual(reversed);

    await asOwner(`${base()}/order`, {
      method: "PUT",
      ...json({ ids: before.map((level) => level.id) }),
    });
  });

  it("deletes a level, moving its tracks, collections and sessions to the replacement", async () => {
    requireProject();
    const doomed = (await (
      await asOwner(base(), {
        method: "POST",
        ...json({ name: "Doomed", colour: "#333333" }),
      })
    ).json()) as Level;
    const levels = await levelIds(project.id, project.owner);

    const track = await (
      await asOwner("/tracks", {
        method: "POST",
        ...json({
          title: "Doomed Track",
          artists: [],
          projectId: project.id,
          priorityId: doomed.id,
        }),
      })
    ).json();
    const collection = await (
      await asOwner("/collections", {
        method: "POST",
        ...json({
          title: "Doomed Collection",
          projectId: project.id,
          priorityId: doomed.id,
        }),
      })
    ).json();
    const session = await (
      await asOwner("/sessions", {
        method: "POST",
        ...json({
          name: "Doomed Session",
          daw: "ableton",
          projectId: project.id,
          priorityId: doomed.id,
        }),
      })
    ).json();

    const res = await asOwner(
      `${base()}/${doomed.id}?replaceWith=${levels.High}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(204);

    expect(await levelOf(tracks, track.id)).toBe(levels.High);
    expect(await levelOf(collections, collection.id)).toBe(levels.High);
    expect(await levelOf(sessions, session.id)).toBe(levels.High);
    expect(
      (await scaleOf(project.id, project.owner)).map((level) => level.name)
    ).not.toContain("Doomed");
  });

  it("refuses to delete the default, or without a replacement of its own scale, and changes nothing", async () => {
    requireProject();
    const levels = await levelIds(project.id, project.owner);
    const foreign = await levelIds();
    const trackId = (
      await (
        await asOwner("/tracks", {
          method: "POST",
          ...json({
            title: "Kept Track",
            artists: [],
            projectId: project.id,
            priorityId: levels.Medium,
          }),
        })
      ).json()
    ).id as number;

    for (const path of [
      `${base()}/${levels.None}?replaceWith=${levels.Low}`,
      `${base()}/${levels.Medium}`,
      `${base()}/${levels.Medium}?replaceWith=${levels.Medium}`,
      `${base()}/${levels.Medium}?replaceWith=${foreign.Low}`,
    ]) {
      const res = await asOwner(path, { method: "DELETE" });
      expect(res.status, path).toBe(400);
    }

    const scale = await levelIds(project.id, project.owner);
    expect(scale.None).toBe(levels.None);
    expect(scale.Medium).toBe(levels.Medium);
    expect(await levelOf(tracks, trackId)).toBe(levels.Medium);
  });

  it("answers 404 for deleting a level the project does not have", async () => {
    requireProject();
    const levels = await levelIds(project.id, project.owner);
    const res = await asOwner(
      `${base()}/2000000000?replaceWith=${levels.Low}`,
      { method: "DELETE" }
    );
    expect(res.status).toBe(404);
  });
});

describe("rows on the scale", () => {
  it("creates a track, collection and session at the default when the body names no level", async () => {
    requireProject();
    const levels = await levelIds();

    const trackId = await mkTrack("Default Track");
    const collectionId = await mkCollection("Default Collection");
    const session = await mkSession({ name: "Default Session" });

    expect(await levelOf(tracks, trackId)).toBe(levels.None);
    expect(await levelOf(collections, collectionId)).toBe(levels.None);
    expect(await levelOf(sessions, session.id)).toBe(levels.None);
  });

  it("carries the level object on list rows and detail bodies", async () => {
    requireProject();
    const levels = await levelIds();
    const trackId = await mkTrack("Level Object");
    await request("owner", `/tracks/${trackId}`, {
      method: "PATCH",
      ...json({ priorityId: levels.Urgent }),
    });

    const detail = await (await request("owner", `/tracks/${trackId}`)).json();
    expect(detail.priority).toEqual({
      id: levels.Urgent,
      name: "Urgent",
      colour: "#D0183A",
      rank: 4,
    });

    const page = (await (
      await request(
        "owner",
        `/projects/${suite.projectId}/tracks/paginated?q=Level Object`
      )
    ).json()) as Page<{ id: number; priority: unknown }>;
    expect(page.rows.find((row) => row.id === trackId)?.priority).toEqual(
      detail.priority
    );
  });

  it("refuses a level of another project with a 400 on create, patch and bulk patch", async () => {
    requireProject();
    const elsewhere = await throwawayProject("Priority Foreign Body");
    const foreign = await levelIds(elsewhere.id, elsewhere.owner);
    const trackId = await mkTrack("Foreign Target");

    const attempts: [string, string, unknown][] = [
      [
        "POST",
        "/tracks",
        {
          title: "Foreign",
          artists: [],
          projectId: suite.projectId,
          priorityId: foreign.High,
        },
      ],
      [
        "POST",
        "/collections",
        {
          title: "Foreign",
          projectId: suite.projectId,
          priorityId: foreign.High,
        },
      ],
      [
        "POST",
        "/sessions",
        {
          name: "Foreign",
          daw: "ableton",
          projectId: suite.projectId,
          priorityId: foreign.High,
        },
      ],
      ["PATCH", `/tracks/${trackId}`, { priorityId: foreign.High }],
      [
        "PATCH",
        "/tracks/bulk",
        {
          projectId: suite.projectId,
          selection: { ids: [trackId] },
          patch: { priorityId: foreign.High },
        },
      ],
    ];
    for (const [method, path, body] of attempts) {
      const res = await request("owner", path, { method, ...json(body) });
      expect(res.status, `${method} ${path}`).toBe(400);
    }
  });
});

describe("listing by priority", () => {
  const page = async <T>(entity: string, qs: string): Promise<Page<T>> => {
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/${entity}/paginated?${qs}`
    );
    expect(res.status, qs).toBe(200);
    return res.json();
  };

  /** Three tracks of one search term, at Urgent, Low and None. */
  async function seedTracks(term: string) {
    const levels = await levelIds();
    const urgent = await mkTrack(`${term} urgent`);
    const low = await mkTrack(`${term} low`);
    const none = await mkTrack(`${term} none`);
    for (const [id, level] of [
      [urgent, levels.Urgent],
      [low, levels.Low],
    ] as const) {
      await request("owner", `/tracks/${id}`, {
        method: "PATCH",
        ...json({ priorityId: level }),
      });
    }
    return { levels, urgent, low, none };
  }

  it("groups by level in the scale's rank order, labelled by name", async () => {
    requireProject();
    const { levels, urgent, low, none } = await seedTracks("prio-group");

    const grouped = await page<{ id: number }>(
      "tracks",
      "q=prio-group&groupBy=priority"
    );
    expect(grouped.groups).toEqual([
      { key: String(levels.None), label: "None", count: 1 },
      { key: String(levels.Low), label: "Low", count: 1 },
      { key: String(levels.Urgent), label: "Urgent", count: 1 },
    ]);
    expect(grouped.rows.map((row) => row.id)).toEqual([none, low, urgent]);
  });

  it("filters by one or more levels, and counts every level in its facet", async () => {
    requireProject();
    const { levels, urgent, low } = await seedTracks("prio-filter");

    const filtered = await page<{ id: number }>(
      "tracks",
      `q=prio-filter&priority=${levels.Urgent},${levels.Low}&sort=priority.desc`
    );
    expect(filtered.rows.map((row) => row.id)).toEqual([urgent, low]);
    expect(filtered.facets.priority).toEqual({
      [String(levels.None)]: 1,
      [String(levels.Low)]: 1,
      [String(levels.Urgent)]: 1,
    });

    const one = await page<{ id: number }>(
      "tracks",
      `q=prio-filter&priority=${levels.Urgent}`
    );
    expect(one.rows.map((row) => row.id)).toEqual([urgent]);
  });

  it("refuses a malformed level list", async () => {
    requireProject();
    const res = await request(
      "owner",
      `/projects/${suite.projectId}/tracks/paginated?priority=high`
    );
    expect(res.status).toBe(400);
  });

  it("sorts, groups and filters collections and sessions by level too", async () => {
    requireProject();
    const levels = await levelIds();
    const plainCollection = await mkCollection("prio-coll plain");
    const highCollection = await mkCollection("prio-coll high");
    await request("owner", `/collections/${highCollection}`, {
      method: "PATCH",
      ...json({ priorityId: levels.High }),
    });
    const plainSession = await mkSession({ name: "prio-sess plain" });
    const highSession = await mkSession({
      name: "prio-sess high",
      priorityId: levels.High,
    });

    const collectionsDesc = await page<{ id: number }>(
      "collections",
      "q=prio-coll&sort=priority.desc"
    );
    expect(collectionsDesc.rows.map((row) => row.id)).toEqual([
      highCollection,
      plainCollection,
    ]);
    const collectionGroups = await page<{ id: number }>(
      "collections",
      "q=prio-coll&groupBy=priority"
    );
    expect(collectionGroups.groups.map((group) => group.label)).toEqual([
      "None",
      "High",
    ]);

    const sessionsAsc = await page<{ id: number }>(
      "sessions",
      "q=prio-sess&sort=priority.asc"
    );
    expect(sessionsAsc.rows.map((row) => row.id)).toEqual([
      plainSession.id,
      highSession.id,
    ]);
    const highSessions = await page<{ id: number }>(
      "sessions",
      `q=prio-sess&priority=${levels.High}`
    );
    expect(highSessions.rows.map((row) => row.id)).toEqual([highSession.id]);
  });
});

describe("moving a row to another project", () => {
  it("answers with the levels the target's scale had no name for", async () => {
    requireProject();
    const target = await throwawayProject("Priority Move Target");
    await suite.seedMember(target.owner, "editor");
    const created = (await (
      await request("owner", `/projects/${suite.projectId}/priorities`, {
        method: "POST",
        ...json({ name: "Only Here", colour: "#0A0B0C" }),
      })
    ).json()) as Level;
    const trackId = await mkTrack("Moving Priority");
    await request("owner", `/tracks/${trackId}`, {
      method: "PATCH",
      ...json({ priorityId: created.id }),
    });

    const res = await requestAs(target.owner, `/tracks/${trackId}/move`, {
      method: "POST",
      ...json({ projectId: target.id }),
    });
    expect(res.status).toBe(200);
    const moved = await res.json();
    const targetLevels = await levelIds(target.id, target.owner);
    expect(moved.priorityId).toBe(targetLevels.None);
    expect(moved.priorityFallbacks).toEqual([
      { from: "Only Here", to: "None", count: 1 },
    ]);
  });
});

describe("deleting a project", () => {
  it("takes its scale with it, rows that hold a level included", async () => {
    requireProject();
    const doomed = await throwawayProject("Priority Project Delete");
    const levels = await levelIds(doomed.id, doomed.owner);
    const create = (path: string, body: Record<string, unknown>) =>
      requestAs(doomed.owner, path, {
        method: "POST",
        ...json({ ...body, projectId: doomed.id, priorityId: levels.High }),
      });
    expect(
      (await create("/tracks", { title: "Gone", artists: [] })).status
    ).toBe(201);
    expect((await create("/collections", { title: "Gone" })).status).toBe(201);
    expect(
      (await create("/sessions", { name: "Gone", daw: "ableton" })).status
    ).toBe(201);

    const res = await requestAs(doomed.owner, `/projects/${doomed.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(204);
    const left = await db
      .select({ id: priorityLevels.id })
      .from(priorityLevels)
      .where(eq(priorityLevels.projectId, doomed.id));
    expect(left).toEqual([]);
  });
});
