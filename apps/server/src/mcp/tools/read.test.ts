import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  DEFAULT_RELATION_TYPES,
  relationTypeByName,
} from "../../db/queries/track-relation-types.js";
import { tracks } from "../../db/schema/tracks.js";
import {
  callTool,
  ensureMcpServerListening,
  listToolNames,
  listTools,
  mintMcpToken,
} from "../../test/mcp.js";
import { setupSuite } from "../../test/fixtures.js";
import type { Actor } from "../actor.js";
import { getProjectDetail, listProjects } from "./read.js";

const suite = setupSuite("MCP read tools");
const { owner, outsider, request } = suite;

function actorFor(userId: string): Actor {
  return {
    id: userId,
    name: "",
    scopes: new Set(["read"]),
    user: {} as Actor["user"],
  };
}

describe("listProjects", () => {
  it("lists a project the actor is a member of", async () => {
    suite.requireProject();
    const projects = await listProjects(actorFor(owner.userId));
    expect(projects.some((project) => project.id === suite.projectId)).toBe(
      true
    );
  });
});

describe("getProjectDetail", () => {
  it("carries the project's statuses, priority scale, relation types, labels and members", async () => {
    suite.requireProject();
    const detail = await getProjectDetail(
      actorFor(owner.userId),
      suite.projectId
    );
    expect(detail.id).toBe(suite.projectId);
    expect(Array.isArray(detail.statuses)).toBe(true);
    expect(detail.priorities.map((level) => level.name)).toEqual([
      "None",
      "Low",
      "Medium",
      "High",
      "Urgent",
    ]);
    expect(detail.relationTypes.map((type) => type.name)).toEqual([
      ...DEFAULT_RELATION_TYPES,
    ]);
    expect(Array.isArray(detail.labels)).toBe(true);
    expect(
      detail.members.some((member) => member.userId === owner.userId)
    ).toBe(true);
  });

  it("refuses a caller who is not a member of the project", async () => {
    suite.requireProject();
    await expect(
      getProjectDetail(actorFor(outsider.userId), suite.projectId)
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("read tools over /api/mcp", () => {
  beforeAll(ensureMcpServerListening);

  it("list_projects answers the caller's own projects", async () => {
    suite.requireProject();
    const token = await mintMcpToken(owner, ["read"]);
    const { status, body } = await callTool(token, "list_projects", {});
    expect(status).toBe(200);
    const result = body as {
      result: { structuredContent: { projects: { id: number }[] } };
    };
    expect(
      result.result.structuredContent.projects.some(
        (project) => project.id === suite.projectId
      )
    ).toBe(true);
  });

  it("get_project answers 404 for a project the actor is not in", async () => {
    suite.requireProject();
    const token = await mintMcpToken(outsider, ["read"]);
    const { body } = await callTool(token, "get_project", {
      projectId: suite.projectId,
    });
    const result = body as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0]?.text).toContain("404");
  });

  it("get_project carries statuses, labels and members for a member", async () => {
    suite.requireProject();
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "get_project", {
      projectId: suite.projectId,
    });
    const result = body as {
      result: {
        structuredContent: {
          id: number;
          statuses: unknown[];
          members: unknown[];
        };
      };
    };
    expect(result.result.structuredContent.id).toBe(suite.projectId);
    expect(Array.isArray(result.result.structuredContent.statuses)).toBe(true);
    expect(Array.isArray(result.result.structuredContent.members)).toBe(true);
  });

  it("list_tracks filters by a relation type's name, and answers 404 for a name the list lacks", async () => {
    suite.requireProject();
    const source = await suite.mkTrack("MCP Relation Source");
    const cover = await suite.mkTrack("MCP Relation Cover");
    const alone = await suite.mkTrack("MCP Relation Alone");
    const type = await relationTypeByName(suite.projectId, "cover");
    const related = await request("owner", `/tracks/${cover}/relations`, {
      method: "POST",
      body: JSON.stringify({ toTrackId: source, relationTypeId: type!.id }),
    });
    expect(related.status).toBe(201);
    const token = await mintMcpToken(owner, ["read"]);
    const listed = async (relation: string) => {
      const { body } = await callTool(token, "list_tracks", {
        projectId: suite.projectId,
        relation,
        q: "MCP Relation",
      });
      return body as {
        result: {
          isError?: boolean;
          content: { text: string }[];
          structuredContent?: { rows: { id: number }[] };
        };
      };
    };

    for (const relation of ["cover", "any"]) {
      const ids = (await listed(relation)).result.structuredContent!.rows.map(
        (row) => row.id
      );
      expect(ids.toSorted()).toEqual([source, cover].toSorted());
      expect(ids).not.toContain(alone);
    }

    const unknown = await listed("bootleg");
    expect(unknown.result.isError).toBe(true);
    expect(unknown.result.content[0]?.text).toContain(
      'No relation type named "bootleg"'
    );
  });

  it("list_tracks returns the same rows and rowCount as the REST paginated route", async () => {
    suite.requireProject();
    await suite.mkTrack("MCP Track A");
    await suite.mkTrack("MCP Track B");
    const token = await mintMcpToken(owner, ["read"]);

    const { body } = await callTool(token, "list_tracks", {
      projectId: suite.projectId,
      page: 1,
      pageSize: 50,
    });
    const toolResult = body as {
      result: {
        structuredContent: { rows: { id: number }[]; rowCount: number };
      };
    };

    const restRes = await request(
      "owner",
      `/projects/${suite.projectId}/tracks/paginated?page=1&pageSize=50`
    );
    const restBody = (await restRes.json()) as {
      rows: { id: number }[];
      rowCount: number;
    };

    expect(toolResult.result.structuredContent.rowCount).toBe(
      restBody.rowCount
    );
    expect(
      toolResult.result.structuredContent.rows.map((r) => r.id).sort()
    ).toEqual(restBody.rows.map((r) => r.id).sort());
  });

  it("get_track returns its audio version summaries", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("MCP Track Detail");
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "get_track", { id: trackId });
    const result = body as {
      result: { structuredContent: { id: number; audioVersions: unknown[] } };
    };
    expect(result.result.structuredContent.id).toBe(trackId);
    expect(Array.isArray(result.result.structuredContent.audioVersions)).toBe(
      true
    );
  });

  it("get_track lists sessions as summaries, without samples or structure", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("MCP Track Session Summary");
    const session = await suite.mkSession({
      trackId,
      main: true,
      samples: [
        { path: "/samples/kick.wav", kind: "project", status: "present" },
      ],
      structure: { tracks: [], clips: { audio: 0, midi: 0 } },
    });
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "get_track", { id: trackId });
    const result = body as {
      result: { structuredContent: { sessions: Record<string, unknown>[] } };
    };
    const [summary] = result.result.structuredContent.sessions;
    expect(summary?.id).toBe(session.id);
    expect(Object.keys(summary ?? {}).sort()).toEqual(
      [
        "id",
        "name",
        "main",
        "daw",
        "tempo",
        "timeSignature",
        "rootNote",
        "scale",
        "localFilepath",
        "localFileUpdatedAt",
        "updatedAt",
      ].sort()
    );
    expect(summary).not.toHaveProperty("samples");
    expect(summary).not.toHaveProperty("structure");
  });

  it("get_track answers a 404 isError for an outsider, the same as a nonexistent id", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("MCP Track Outsider");
    const outsiderToken = await mintMcpToken(outsider, ["read"]);

    const forReal = await callTool(outsiderToken, "get_track", {
      id: trackId,
    });
    const forMissing = await callTool(outsiderToken, "get_track", {
      id: 999999999,
    });

    const realResult = forReal.body as {
      result: { isError: boolean; content: { text: string }[] };
    };
    const missingResult = forMissing.body as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(realResult.result.isError).toBe(true);
    expect(missingResult.result.isError).toBe(true);
    expect(realResult.result.content[0]?.text).toContain("404");
    expect(realResult.result.content[0]?.text).toBe(
      missingResult.result.content[0]?.text
    );
  });

  it("get_collection returns the collection's detail", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("MCP Collection");
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "get_collection", {
      id: collectionId,
    });
    const result = body as { result: { structuredContent: { id: number } } };
    expect(result.result.structuredContent.id).toBe(collectionId);
  });

  it("get_session returns the session's detail, including samples and structure", async () => {
    suite.requireProject();
    const sample = {
      path: "/samples/snare.wav",
      kind: "library",
      status: "present",
    };
    const session = await suite.mkSession({
      samples: [sample],
      structure: { tracks: [], clips: { audio: 0, midi: 0 } },
    });
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "get_session", {
      id: session.id,
    });
    const result = body as {
      result: {
        structuredContent: {
          id: number;
          samples: unknown[];
          structure: unknown;
        };
      };
    };
    expect(result.result.structuredContent.id).toBe(session.id);
    expect(result.result.structuredContent.samples).toEqual([
      { ...sample, held: false, object: null },
    ]);
    expect(result.result.structuredContent.structure).not.toBeNull();
  });

  it("list_collection_tracks lists a collection's tracks in order", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("MCP Collection Tracks");
    const trackId = await suite.mkTrack("MCP Collection Track");
    const linked = await request(
      "owner",
      `/collections/${collectionId}/tracks`,
      { method: "POST", body: JSON.stringify({ trackId, trackNumber: 1 }) }
    );
    expect(linked.status).toBe(200);

    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "list_collection_tracks", {
      collectionId,
    });
    const result = body as {
      result: { structuredContent: { tracks: { id: number }[] } };
    };
    expect(
      result.result.structuredContent.tracks.some((t) => t.id === trackId)
    ).toBe(true);
  });

  it("list_track_sessions omits structure by default and includes it when includeStructure is true", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("MCP Track Sessions");
    const structure = {
      tracks: [
        { kind: "audio" as const, name: "Drums", devices: ["EQ Eight"] },
      ],
      clips: { audio: 2, midi: 0 },
    };
    const session = await suite.mkSession({
      trackId,
      main: true,
      structure,
    });
    const token = await mintMcpToken(owner, ["read"]);

    const lean = await callTool(token, "list_track_sessions", { trackId });
    const leanSessions = (
      lean.body as {
        result: {
          structuredContent: { sessions: Record<string, unknown>[] };
        };
      }
    ).result.structuredContent.sessions;
    const leanRow = leanSessions.find((s) => s.id === session.id);
    expect(leanRow).toBeDefined();
    expect(leanRow).not.toHaveProperty("structure");

    const full = await callTool(token, "list_track_sessions", {
      trackId,
      includeStructure: true,
    });
    const fullSessions = (
      full.body as {
        result: {
          structuredContent: { sessions: { id: number; structure: unknown }[] };
        };
      }
    ).result.structuredContent.sessions;
    const fullRow = fullSessions.find((s) => s.id === session.id);
    expect(fullRow?.structure).toEqual(structure);
  });

  it("list_sessions omits structure", async () => {
    suite.requireProject();
    const session = await suite.mkSession({
      name: "MCP Lean Session List",
      structure: { tracks: [], clips: { audio: 1, midi: 0 } },
    });
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "list_sessions", {
      projectId: suite.projectId,
      q: "MCP Lean Session List",
    });
    const rows = (
      body as {
        result: { structuredContent: { rows: Record<string, unknown>[] } };
      }
    ).result.structuredContent.rows;
    const row = rows.find((r) => r.id === session.id);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("structure");
  });

  it("search finds a seeded track for a two-character query", async () => {
    suite.requireProject();
    const title = "Zq";
    await suite.mkTrack(title);
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "search", {
      projectId: suite.projectId,
      q: title,
    });
    const result = body as {
      result: { structuredContent: { results: { title: string }[] } };
    };
    expect(
      result.result.structuredContent.results.some((r) => r.title === title)
    ).toBe(true);
  });

  it("get_activity returns the project's activity feed", async () => {
    suite.requireProject();
    await suite.mkTrack("MCP Activity Track");
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "get_activity", {
      projectId: suite.projectId,
    });
    const result = body as {
      result: { structuredContent: { activity: unknown[] } };
    };
    expect(result.result.structuredContent.activity.length).toBeGreaterThan(0);
  });

  it("tools/list succeeds over the real TOOLS, including get_track's slimmed sessions schema", async () => {
    const token = await mintMcpToken(owner, ["read"]);
    const names = await listToolNames(token);
    expect(names).toContain("get_track");
    expect(names).toContain("get_session");
  });

  it("list_tracks sorts by a <key>.<dir> sort", async () => {
    suite.requireProject();
    await suite.mkTrack("Sorted Track A");
    await suite.mkTrack("Sorted Track B");
    await suite.mkTrack("Sorted Track C");
    const token = await mintMcpToken(owner, ["read"]);

    const { body } = await callTool(token, "list_tracks", {
      projectId: suite.projectId,
      page: 1,
      pageSize: 50,
      sort: "updatedAt.desc",
    });
    const { result } = body as {
      result: { structuredContent: { rows: { updatedAt: string }[] } };
    };

    const stamps = result.structuredContent.rows.map((row) => row.updatedAt);
    expect(stamps.length).toBeGreaterThan(1);
    // Non-increasing rather than a fixed id order, so rows written inside the
    // same millisecond do not decide whether this passes.
    expect([...stamps].sort().reverse()).toEqual(stamps);
  });

  it("list_tracks rejects a bare sort key and an unknown groupBy, naming what it takes", async () => {
    suite.requireProject();
    const token = await mintMcpToken(owner, ["read"]);

    const bad = async (args: Record<string, unknown>) => {
      const { body } = await callTool(token, "list_tracks", {
        projectId: suite.projectId,
        ...args,
      });
      const { result } = body as {
        result: { isError: boolean; content: { text: string }[] };
      };
      expect(result.isError).toBe(true);
      return result.content.map((part) => part.text).join(" ");
    };

    // The shape that looked like it worked: REST reads "-updatedAt" as no
    // recognised key and quietly serves the default order.
    expect(await bad({ sort: "-updatedAt" })).toContain("updatedAt.desc");
    expect(await bad({ groupBy: "nope" })).toContain("status");
  });

  it("tools/list spells out list_tracks' sort and groupBy keys, custom fields included", async () => {
    const token = await mintMcpToken(owner, ["read"]);
    const listed = (await listTools(token)).find(
      (tool) => tool.name === "list_tracks"
    );

    expect(listed?.description).toContain('Sort as "<key>.asc"');
    expect(listed?.description).toContain("updatedAt");
    expect(listed?.description).toContain("trackNumber");
    expect(listed?.description).toContain("artist");
    expect(listed?.description).toContain("cf_<id>");
  });

  it("list_tracks sorts, filters and groups by a project's own custom field, and refuses another project's", async () => {
    suite.requireProject();
    const created = await request(
      "owner",
      `/projects/${suite.projectId}/fields`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: "track",
          name: "MCP Energy",
          type: "select",
          options: [{ label: "High" }, { label: "Low" }],
        }),
      }
    );
    const field = (await created.json()) as {
      id: number;
      options: { id: string }[];
    };
    const key = `cf_${field.id}`;
    const [high, low] = field.options as [{ id: string }, { id: string }];
    const tagged = async (title: string, option: string) => {
      const id = await suite.mkTrack(title);
      await request("owner", `/tracks/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { [key]: option } }),
      });
      return id;
    };
    const highId = await tagged("MCP Energy High", high.id);
    const lowId = await tagged("MCP Energy Low", low.id);
    const token = await mintMcpToken(owner, ["read"]);

    const { body } = await callTool(token, "list_tracks", {
      projectId: suite.projectId,
      q: "MCP Energy",
      sort: `${key}.desc`,
      [key]: `${high.id},${low.id}`,
      groupBy: key,
    });
    const { result } = body as {
      result: {
        structuredContent: {
          rows: { id: number }[];
          groups: { label: string }[];
        };
      };
    };
    expect(result.structuredContent.rows.map((row) => row.id)).toEqual([
      highId,
      lowId,
    ]);
    expect(result.structuredContent.groups.map((g) => g.label)).toEqual([
      "High",
      "Low",
    ]);

    const refused = await callTool(token, "list_tracks", {
      projectId: suite.projectId,
      sort: "cf_999999.asc",
    });
    const refusal = refused.body as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(refusal.result.isError).toBe(true);
    expect(refusal.result.content[0]?.text).toContain(`${key}.asc`);
  });

  it("get_project lists the project's custom fields", async () => {
    suite.requireProject();
    const created = await request(
      "owner",
      `/projects/${suite.projectId}/fields`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: "collection",
          name: "MCP Catalogue",
          type: "text",
        }),
      }
    );
    const field = (await created.json()) as { id: number };
    const detail = await getProjectDetail(
      actorFor(owner.userId),
      suite.projectId
    );
    expect(detail.customFields.map((f) => f.id)).toContain(field.id);
  });

  it("list_tracks hides archived tracks unless archived is only", async () => {
    suite.requireProject();
    const live = await suite.mkTrack("McpArc live");
    const archived = await suite.mkTrack("McpArc gone");
    await db
      .update(tracks)
      .set({ archivedAt: new Date() })
      .where(eq(tracks.id, archived));
    const token = await mintMcpToken(owner, ["read"]);

    const listedIds = async (args: Record<string, unknown>) => {
      const { body } = await callTool(token, "list_tracks", {
        projectId: suite.projectId,
        q: "McpArc",
        ...args,
      });
      const { result } = body as {
        result: { structuredContent: { rows: { id: number }[] } };
      };
      return result.structuredContent.rows.map((row) => row.id);
    };

    expect(await listedIds({})).toEqual([live]);
    expect(await listedIds({ archived: "only" })).toEqual([archived]);
  });

  it("list_tracks rejects mistyped filter keys like statusId and collectionId loudly", async () => {
    suite.requireProject();
    const token = await mintMcpToken(owner, ["read"]);
    const { body } = await callTool(token, "list_tracks", {
      projectId: suite.projectId,
      statusId: 1,
      collectionId: 7,
    });
    const result = body as {
      result: { isError: boolean; content: { text: string }[] };
    };
    expect(result.result.isError).toBe(true);
    const text = result.result.content[0]?.text ?? "";
    expect(text).toContain('"statusId"');
    expect(text).toContain('"collectionId"');
    expect(text).toContain("status");
    expect(text).toContain("collection");
  });

  it("list_tracks supports audit filters and compact: true slim rows with hasNotes/hasLyrics/audioCount", async () => {
    suite.requireProject();
    const rich = await suite.mkTrack("McpAudit Rich");
    const bare = await suite.mkTrack("McpAudit Bare");

    // Give `rich` notes, lyrics, image, audio, session, label, and collection.
    const collectionId = await suite.mkCollection("McpAudit Col");
    await request("owner", `/collections/${collectionId}/tracks`, {
      method: "POST",
      body: JSON.stringify({ trackId: rich, trackNumber: 1 }),
    });
    await request("owner", `/tracks/${rich}`, {
      method: "PATCH",
      body: JSON.stringify({
        notes: [
          { type: "paragraph", content: [{ type: "text", text: "Mix notes" }] },
        ],
      }),
    });
    await db
      .update(tracks)
      .set({ image: "images/mcp-audit-cover.jpg" })
      .where(eq(tracks.id, rich));
    await suite.mkPrimaryAudioWithLoudness(rich, -14);
    await suite.mkSession({ trackId: rich, main: true });
    await request("owner", `/tracks/${rich}/labels`, {
      method: "PUT",
      body: JSON.stringify({ names: ["ambient"] }),
    });
    const writeToken = await mintMcpToken(owner, ["read", "write"]);
    await callTool(writeToken, "write_lyrics", {
      trackId: rich,
      markdown: "[Verse 1]\nLine one",
    });

    const token = await mintMcpToken(owner, ["read"]);
    const idsFor = async (filters: Record<string, unknown>) => {
      const { body } = await callTool(token, "list_tracks", {
        projectId: suite.projectId,
        q: "McpAudit",
        ...filters,
      });
      const res = body as {
        result: {
          isError?: boolean;
          structuredContent: { rows: { id: number }[] };
        };
      };
      expect(res.result.isError).toBeUndefined();
      return res.result.structuredContent.rows.map((r) => r.id);
    };

    expect(await idsFor({ unlabeled: true })).toEqual([bare]);
    expect(await idsFor({ unlabeled: false })).toEqual([rich]);
    expect(await idsFor({ uncollected: true })).toEqual([bare]);
    expect(await idsFor({ uncollected: false })).toEqual([rich]);
    expect(await idsFor({ hasNotes: true })).toEqual([rich]);
    expect(await idsFor({ hasNotes: false })).toEqual([bare]);
    expect(await idsFor({ hasLyrics: true })).toEqual([rich]);
    expect(await idsFor({ hasLyrics: false })).toEqual([bare]);
    expect(await idsFor({ hasImage: true })).toEqual([rich]);
    expect(await idsFor({ hasImage: false })).toEqual([bare]);
    expect(await idsFor({ hasAudio: true })).toEqual([rich]);
    expect(await idsFor({ hasAudio: false })).toEqual([bare]);
    expect(await idsFor({ hasSessions: true })).toEqual([rich]);
    expect(await idsFor({ hasSessions: false })).toEqual([bare]);

    // Full rows expose hasNotes, hasLyrics, audioCount.
    const full = await callTool(token, "list_tracks", {
      projectId: suite.projectId,
      q: "McpAudit",
    });
    const fullRows = (
      full.body as {
        result: {
          structuredContent: {
            rows: {
              id: number;
              hasNotes: boolean;
              hasLyrics: boolean;
              audioCount: number;
            }[];
          };
        };
      }
    ).result.structuredContent.rows;
    expect(fullRows.find((r) => r.id === rich)).toMatchObject({
      hasNotes: true,
      hasLyrics: true,
      audioCount: 1,
    });
    expect(fullRows.find((r) => r.id === bare)).toMatchObject({
      hasNotes: false,
      hasLyrics: false,
      audioCount: 0,
    });

    // Compact rows flatten nested objects while keeping envelope metadata.
    const compact = await callTool(token, "list_tracks", {
      projectId: suite.projectId,
      q: "McpAudit",
      compact: true,
    });
    const compactContent = (
      compact.body as {
        result: {
          structuredContent: {
            rows: Record<string, unknown>[];
            rowCount: number;
            page: number;
            pageSize: number;
            facets: Record<string, unknown>;
          };
        };
      }
    ).result.structuredContent;
    expect(compactContent.rowCount).toBe(2);
    expect(compactContent.page).toBe(1);
    expect(compactContent.pageSize).toBe(50);
    expect(compactContent.facets).toBeDefined();

    const richCompact = compactContent.rows.find((r) => r.id === rich)!;
    expect(richCompact).toMatchObject({
      id: rich,
      title: "McpAudit Rich",
      collectionIds: [collectionId],
      labelNames: ["ambient"],
      hasNotes: true,
      hasLyrics: true,
      hasImage: true,
      audioCount: 1,
      sessionCount: 1,
    });
    expect(richCompact).not.toHaveProperty("status");
    expect(richCompact).not.toHaveProperty("labels");
    expect(richCompact).not.toHaveProperty("collections");
    expect(richCompact).not.toHaveProperty("sessions");
    expect(typeof richCompact.statusName).toBe("string");

    const bareCompact = compactContent.rows.find((r) => r.id === bare)!;
    expect(bareCompact).toMatchObject({
      id: bare,
      collectionIds: [],
      labelNames: [],
      hasNotes: false,
      hasLyrics: false,
      hasImage: false,
      audioCount: 0,
      sessionCount: 0,
    });
  });
});
