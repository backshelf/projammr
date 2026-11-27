import { beforeAll, describe, expect, it, setSystemTime } from "bun:test";
import { app } from "../../app.js";
import { getProjectActivity } from "../../db/queries/activity-feed.js";
import { withProjectPolicyForTest } from "../../db/queries/project-policy.js";
import { relationTypeByName } from "../../db/queries/track-relation-types.js";
import { baseUrl, cookieHeaders, setupSuite } from "../../test/fixtures.js";
import {
  callTool,
  ensureMcpServerListening,
  listToolNames,
  listTools,
  mintMcpToken,
} from "../../test/mcp.js";

const suite = setupSuite("MCP organise tools");
const { owner, editor, viewer } = suite;

beforeAll(ensureMcpServerListening);

async function latestActivity(entityType: string, entityId: number) {
  const rows = await getProjectActivity(suite.projectId, {
    entityType: entityType as never,
    entityId,
  });
  return rows[0];
}

type ToolResult = { status: number; body: unknown };
type ToolResultBody = {
  result?: {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
    content?: { type: "text"; text: string }[];
  };
};

function resultOf(res: ToolResult): ToolResultBody["result"] {
  return (res.body as ToolResultBody).result;
}

/** The row a successful call's `structuredContent` carries. */
function rowFrom(res: ToolResult): Record<string, unknown> {
  const row = resultOf(res)?.structuredContent;
  if (!row) throw new Error(`no structuredContent in ${JSON.stringify(res)}`);
  return row;
}

/** The text of a failed call's `isError` result, for asserting on its message. */
function errorText(res: ToolResult): string {
  expect(resultOf(res)?.isError).toBe(true);
  return resultOf(res)?.content?.[0]?.text ?? "";
}

describe("create_track / create_collection", () => {
  it("creates a track and logs it", async () => {
    suite.requireProject();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "create_track", {
      title: "New Track",
      artists: ["A"],
      projectId: suite.projectId,
    });
    const row = rowFrom(res);
    expect(row.title).toBe("New Track");
    const activity = await latestActivity("track", row.id as number);
    expect(activity?.action).toBe("created");
  });

  it("creates a collection and logs it", async () => {
    suite.requireProject();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "create_collection", {
      title: "New Collection",
      projectId: suite.projectId,
    });
    const row = rowFrom(res);
    expect(row.title).toBe("New Collection");
    const activity = await latestActivity("collection", row.id as number);
    expect(activity?.action).toBe("created");
  });

  it("fills what create_track and create_collection leave out from the project's defaults", async () => {
    suite.requireProject();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const status = await suite.mkStatus("MCP Default Status");

    const [track, collection] = await withProjectPolicyForTest(
      suite.projectId,
      {
        defaults: {
          artists: ["Default Artist"],
          explicit: true,
          collectionStatusId: status.id,
        },
      },
      async () => [
        rowFrom(
          await callTool(token, "create_track", {
            title: "Defaulted MCP Track",
            projectId: suite.projectId,
          })
        ),
        rowFrom(
          await callTool(token, "create_collection", {
            title: "Defaulted MCP Collection",
            projectId: suite.projectId,
          })
        ),
      ]
    );

    expect(track!.artists).toEqual(["Default Artist"]);
    expect(track!.explicit).toBe(true);
    expect(collection!.statusId).toBe(status.id);
  });

  it("has no create_session or create_project tool", async () => {
    suite.requireProject();
    const token = await mintMcpToken(owner, ["read", "write"]);
    const names = await listToolNames(token);
    expect(names).not.toContain("create_session");
    expect(names).not.toContain("create_project");
  });
});

describe("update_track / update_collection / update_session / update_project", () => {
  it("patches a track and logs the change", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Old Title");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "update_track", {
      id: trackId,
      title: "Updated Title",
    });
    expect(rowFrom(res).title).toBe("Updated Title");
    const activity = await latestActivity("track", trackId);
    expect(activity?.action).toBe("updated");
  });

  it("patches a collection", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("Old Collection");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "update_collection", {
      id: collectionId,
      title: "Updated Collection",
    });
    expect(rowFrom(res).title).toBe("Updated Collection");
  });

  it("patches a session", async () => {
    suite.requireProject();
    const session = await suite.mkSession();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "update_session", {
      id: session.id,
      name: "Renamed session",
    });
    expect(rowFrom(res).name).toBe("Renamed session");
  });

  it("normalises the musical key a session patch carries", async () => {
    suite.requireProject();
    const session = await suite.mkSession();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "update_session", {
      id: session.id,
      rootNote: "A♯",
      scale: "major",
    });
    expect(rowFrom(res)).toMatchObject({ rootNote: "A#", scale: "Major" });
  });

  it("fails a session patch whose root note names no pitch", async () => {
    suite.requireProject();
    const session = await suite.mkSession();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "update_session", {
      id: session.id,
      rootNote: "X",
    });
    expect(errorText(res)).toContain("Not a note");
  });

  it("patches a project", async () => {
    suite.requireProject();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "update_project", {
      id: suite.projectId,
      name: "Renamed project",
    });
    expect(rowFrom(res).name).toBe("Renamed project");
  });

  it("answers 404 for an id with no row", async () => {
    suite.requireProject();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "update_track", {
      id: 999_999_999,
      title: "Should not apply",
    });
    expect(errorText(res)).toContain("404");
  });

  it("answers 404 for a track id in a project the caller cannot reach", async () => {
    // `requireEntity` resolves an id to its real project before gating on
    // membership: a row in another project the caller isn't a member of
    // answers the same 404 a missing id would, so a caller cannot use the
    // distinction to learn it exists at all.
    suite.requireProject();
    const other = await suite.throwawayProject();
    const created = await app.request(`${baseUrl}/tracks`, {
      method: "POST",
      headers: cookieHeaders(other.owner.cookie),
      body: JSON.stringify({
        title: "Foreign",
        artists: ["A"],
        projectId: other.id,
      }),
    });
    const foreignTrackId = ((await created.json()) as { id: number }).id;
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "update_track", {
      id: foreignTrackId,
      title: "Should not apply",
    });
    expect(errorText(res)).toContain("404");
  });

  it("refuses a viewer's own role on a write", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Viewer target");
    const token = await mintMcpToken(viewer, ["read", "write"]);
    const res = await callTool(token, "update_track", {
      id: trackId,
      title: "Nope",
    });
    expect(errorText(res)).toContain("403");
  });
});

describe("delete_track / delete_collection / delete_session / delete_project", () => {
  it("deletes a track and logs it", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("To delete");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "delete_track", { id: trackId });
    expect(res.status).toBe(200);
    const activity = await latestActivity("track", trackId);
    expect(activity?.action).toBe("deleted");
  });

  it("deletes a collection", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("To delete");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "delete_collection", {
      id: collectionId,
    });
    expect(resultOf(res)?.isError).toBeUndefined();
  });

  it("deletes a session", async () => {
    suite.requireProject();
    const session = await suite.mkSession();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "delete_session", { id: session.id });
    expect(resultOf(res)?.isError).toBeUndefined();
  });

  it("refuses an editor deleting a project", async () => {
    suite.requireProject();
    const editorToken = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(editorToken, "delete_project", {
      id: suite.projectId,
    });
    expect(errorText(res)).toContain("403");
  });
});

describe("bulk_update", () => {
  it("patches many tracks at once", async () => {
    suite.requireProject();
    const a = await suite.mkTrack("Bulk A");
    const b = await suite.mkTrack("Bulk B");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "bulk_update", {
      kind: "track",
      projectId: suite.projectId,
      selection: { ids: [a, b] },
      patch: { priority: "High" },
    });
    expect(rowFrom(res).updated).toBe(2);
    expect(await priorityNameOf(a)).toBe("High");
    expect(await priorityNameOf(b)).toBe("High");
  });
});

/** The name of the level a track holds, read back through its detail route. */
async function priorityNameOf(trackId: number): Promise<string> {
  const res = await suite.request("owner", `/tracks/${trackId}`);
  return ((await res.json()) as { priority: { name: string } }).priority.name;
}

describe("priority levels by name", () => {
  it("creates a track at the level its name gives, and at the default without one", async () => {
    suite.requireProject();
    const token = await mintMcpToken(editor, ["read", "write"]);

    const named = rowFrom(
      await callTool(token, "create_track", {
        title: "Named Priority",
        artists: [],
        projectId: suite.projectId,
        priority: "Urgent",
      })
    );
    expect(await priorityNameOf(named.id as number)).toBe("Urgent");

    const unnamed = rowFrom(
      await callTool(token, "create_track", {
        title: "Default Priority",
        artists: [],
        projectId: suite.projectId,
      })
    );
    expect(await priorityNameOf(unnamed.id as number)).toBe("None");
  });

  it("updates a collection's level by name", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("Priority By Name");
    const token = await mintMcpToken(editor, ["read", "write"]);

    await callTool(token, "update_collection", {
      id: collectionId,
      priority: "Medium",
    });

    const res = await suite.request("owner", `/collections/${collectionId}`);
    const detail = (await res.json()) as { priority: { name: string } };
    expect(detail.priority.name).toBe("Medium");
  });

  it("refuses a level name the project's scale does not have", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Unknown Priority");
    const token = await mintMcpToken(editor, ["read", "write"]);

    const res = await callTool(token, "update_track", {
      id: trackId,
      priority: "Someday",
    });

    expect(errorText(res)).toContain('No priority level named "Someday"');
    expect(await priorityNameOf(trackId)).toBe("None");
  });

  it("lists the scale on get_project, bottom level first", async () => {
    suite.requireProject();
    const token = await mintMcpToken(viewer, ["read"]);

    const project = rowFrom(
      await callTool(token, "get_project", { projectId: suite.projectId })
    );

    const scale = project.priorities as { name: string; isDefault: boolean }[];
    expect(scale.map((level) => level.name).slice(0, 5)).toEqual([
      "None",
      "Low",
      "Medium",
      "High",
      "Urgent",
    ]);
    expect(scale.find((level) => level.isDefault)?.name).toBe("None");
  });
});

describe("labels", () => {
  it("sets labels by name, creating any missing", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Labelled");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "set_labels", {
      kind: "track",
      id: trackId,
      names: ["Mix ready"],
    });
    const names = (rowFrom(res) as unknown as { name: string }[]).map(
      (l) => l.name
    );
    expect(names).toContain("Mix ready");
    const activity = await latestActivity("track", trackId);
    expect(activity?.action).toBe("updated");
  });

  it("lists a project's labels", async () => {
    suite.requireProject();
    const token = await mintMcpToken(viewer, ["read"]);
    const res = await callTool(token, "list_labels", {
      projectId: suite.projectId,
    });
    expect(resultOf(res)?.isError).toBeUndefined();
  });

  it("deletes a label", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("For label delete");
    const editorToken = await mintMcpToken(editor, ["read", "write"]);
    const setRes = await callTool(editorToken, "set_labels", {
      kind: "track",
      id: trackId,
      names: ["Temp label"],
    });
    const [label] = rowFrom(setRes) as unknown as {
      id: number;
      name: string;
    }[];
    const res = await callTool(editorToken, "delete_label", {
      projectId: suite.projectId,
      labelId: label!.id,
    });
    expect(resultOf(res)?.isError).toBeUndefined();
  });

  it("a read-only token's tools/list omits set_labels", async () => {
    suite.requireProject();
    const token = await mintMcpToken(owner, ["read"]);
    const names = await listToolNames(token);
    expect(names).not.toContain("set_labels");
    expect(names).toContain("list_labels");
  });
});

describe("custom fields", () => {
  let fieldCounter = 0;

  async function mkField(body: Record<string, unknown>) {
    const res = await app.request(
      `${baseUrl}/projects/${suite.projectId}/fields`,
      {
        method: "POST",
        headers: cookieHeaders(owner.cookie),
        body: JSON.stringify({
          ...body,
          name: `${body.name} ${fieldCounter++}`,
        }),
      }
    );
    expect(res.status).toBe(201);
    return (await res.json()) as {
      id: number;
      name: string;
      options: { id: string; label: string }[];
    };
  }

  it("set_field sets a field by name, typed by the field, and logs a cf_<id> change", async () => {
    suite.requireProject();
    const mood = await mkField({
      kind: "track",
      name: "Mood",
      type: "select",
      options: [{ label: "Loud" }, { label: "Soft" }],
    });
    const soft = mood.options[1]!;
    const trackId = await suite.mkTrack("Field target");
    const token = await mintMcpToken(editor, ["read", "write"]);

    const res = await callTool(token, "set_field", {
      kind: "track",
      id: trackId,
      field: mood.name,
      value: "Soft",
    });
    expect(rowFrom(res).fields).toEqual({ [`cf_${mood.id}`]: soft.id });
    const activity = await latestActivity("track", trackId);
    expect(activity?.changes).toEqual({
      [`cf_${mood.id}`]: { from: null, to: soft.id },
    });

    const cleared = await callTool(token, "set_field", {
      kind: "track",
      id: trackId,
      field: mood.name,
      value: null,
    });
    expect(rowFrom(cleared).fields).toEqual({});
  });

  it("set_field answers 400 naming the field for a value that does not fit, and 404 for an unknown name", async () => {
    suite.requireProject();
    const tempo = await mkField({
      kind: "collection",
      name: "Tempo",
      type: "number",
    });
    const collectionId = await suite.mkCollection("Field collection");
    const token = await mintMcpToken(editor, ["read", "write"]);

    const wrong = errorText(
      await callTool(token, "set_field", {
        kind: "collection",
        id: collectionId,
        field: tempo.name,
        value: "fast",
      })
    );
    expect(wrong).toContain("400");
    expect(wrong).toContain(tempo.name);

    const unknown = errorText(
      await callTool(token, "set_field", {
        kind: "collection",
        id: collectionId,
        field: "No Such Field",
        value: 1,
      })
    );
    expect(unknown).toContain("404");
    expect(unknown).toContain("No Such Field");
  });

  it("set_field refuses a viewer", async () => {
    suite.requireProject();
    const flag = await mkField({
      kind: "track",
      name: "Flag",
      type: "checkbox",
    });
    const trackId = await suite.mkTrack("Viewer field target");
    const token = await mintMcpToken(viewer, ["read", "write"]);
    const text = errorText(
      await callTool(token, "set_field", {
        kind: "track",
        id: trackId,
        field: flag.name,
        value: true,
      })
    );
    expect(text).toContain("403");
  });

  it("update_track and bulk_update write a fields bag", async () => {
    suite.requireProject();
    const note = await mkField({ kind: "track", name: "Note", type: "text" });
    const key = `cf_${note.id}`;
    const one = await suite.mkTrack("Bag one");
    const two = await suite.mkTrack("Bag two");
    const token = await mintMcpToken(editor, ["read", "write"]);

    const updated = await callTool(token, "update_track", {
      id: one,
      fields: { [key]: "first" },
    });
    expect(rowFrom(updated).fields).toEqual({ [key]: "first" });

    const bulk = await callTool(token, "bulk_update", {
      kind: "track",
      projectId: suite.projectId,
      selection: { ids: [one, two] },
      patch: { fields: { [key]: "both" } },
    });
    expect(resultOf(bulk)?.structuredContent).toEqual({ updated: 2 });
    const activity = await latestActivity("track", two);
    expect(activity?.changes).toEqual({ [key]: { from: null, to: "both" } });
  });
});

describe("statuses", () => {
  it("sets a track's status by name and logs the change", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Status target");
    const status = await suite.mkStatus("Mixing", 40);
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "set_status", {
      kind: "track",
      id: trackId,
      statusName: status.name,
    });
    expect(rowFrom(res).statusId).toBe(status.id);
    const activity = await latestActivity("track", trackId);
    expect(activity?.action).toBe("updated");
  });

  it("answers 404 with the name when the status does not exist", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("No such status");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "set_status", {
      kind: "track",
      id: trackId,
      statusName: "Nonexistent Status Name",
    });
    const text = errorText(res);
    expect(text).toContain("Nonexistent Status Name");
    expect(text).toContain("404");
  });

  it("creates, updates and deletes a project status", async () => {
    suite.requireProject();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const created = await callTool(token, "create_status", {
      name: "Editing",
      percentage: 10,
      projectId: suite.projectId,
    });
    const status = rowFrom(created);

    const updated = await callTool(token, "update_status", {
      id: status.id,
      percentage: 20,
    });
    expect(rowFrom(updated).percentage).toBe(20);

    const deleted = await callTool(token, "delete_status", {
      id: status.id as number,
    });
    expect(resultOf(deleted)?.isError).toBeUndefined();
  });
});

describe("archive_track / unarchive_track", () => {
  async function archiveActions(trackId: number) {
    const rows = await getProjectActivity(suite.projectId, {
      entityType: "track",
      entityId: trackId,
    });
    return rows
      .map((r) => r.action)
      .filter((a) => a === "archived" || a === "unarchived");
  }

  it("archives a track, answers the row and logs one archived entry", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("To archive");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "archive_track", { id: trackId });
    expect(rowFrom(res).id).toBe(trackId);
    expect(rowFrom(res).archivedAt).toBeTruthy();
    expect(await archiveActions(trackId)).toEqual(["archived"]);
  });

  it("succeeds and logs nothing when the track is already archived", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Archived twice");
    const token = await mintMcpToken(editor, ["read", "write"]);
    await callTool(token, "archive_track", { id: trackId });
    const again = await callTool(token, "archive_track", { id: trackId });
    expect(resultOf(again)?.isError).toBeUndefined();
    expect(rowFrom(again).archivedAt).toBeTruthy();
    expect(await archiveActions(trackId)).toEqual(["archived"]);
  });

  it("unarchives a track, clearing the timestamp and logging one unarchived entry", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("To unarchive");
    const token = await mintMcpToken(editor, ["read", "write"]);
    await callTool(token, "archive_track", { id: trackId });
    const res = await callTool(token, "unarchive_track", { id: trackId });
    expect(rowFrom(res).archivedAt).toBeNull();
    expect(await archiveActions(trackId)).toEqual(["unarchived", "archived"]);
  });

  it("refuses a viewer and leaves the track live", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Viewer archive");
    const token = await mintMcpToken(viewer, ["read", "write"]);
    const res = await callTool(token, "archive_track", { id: trackId });
    expect(errorText(res)).toContain("403");
    expect(await archiveActions(trackId)).toEqual([]);
  });
});

describe("organising tools in tools/list", () => {
  const organiseToolNames = [
    "batch_update_tracks",
    "create_label",
    "update_label",
    "archive_track",
    "unarchive_track",
    "add_tracks_to_collection",
    "remove_track_from_collection",
    "set_track_number",
    "set_collection_order",
    "link_sessions",
    "add_track_relation",
    "remove_track_relation",
    "move_to_project",
  ];

  it("lists every organising tool for a write token", async () => {
    suite.requireProject();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const names = await listToolNames(token);
    for (const name of organiseToolNames) expect(names).toContain(name);
  });

  it("omits every organising tool for a read-only token", async () => {
    suite.requireProject();
    const token = await mintMcpToken(editor, ["read"]);
    const names = await listToolNames(token);
    for (const name of organiseToolNames) expect(names).not.toContain(name);
  });
});

/** A track in another project, created by that project's owner. */
async function foreignTrack(other: { id: number; owner: { cookie: string } }) {
  const res = await app.request(`${baseUrl}/tracks`, {
    method: "POST",
    headers: cookieHeaders(other.owner.cookie),
    body: JSON.stringify({
      title: "Foreign",
      artists: ["A"],
      projectId: other.id,
    }),
  });
  return ((await res.json()) as { id: number }).id;
}

type CollectionTrack = { id: number; trackNumber: number | null };

describe("collection membership and order", () => {
  it("adds tracks to a collection, idempotently, and logs it", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("Membership");
    const a = await suite.mkTrack("Member A");
    const b = await suite.mkTrack("Member B");
    const token = await mintMcpToken(editor, ["read", "write"]);

    const first = await callTool(token, "add_tracks_to_collection", {
      collectionId,
      trackIds: [a, b],
    });
    expect(rowFrom(first).added).toBe(2);
    const again = await callTool(token, "add_tracks_to_collection", {
      collectionId,
      trackIds: [a, b],
    });
    expect(rowFrom(again).added).toBe(0);

    const activity = await latestActivity("collection", collectionId);
    expect(activity?.action).toBe("updated");
    expect(activity?.changes?.tracks?.to).toEqual(["Member A", "Member B"]);
  });

  it("answers 404 for a track from another project", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("Foreign member");
    const other = await suite.throwawayProject();
    const foreignId = await foreignTrack(other);
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "add_tracks_to_collection", {
      collectionId,
      trackIds: [foreignId],
    });
    expect(errorText(res)).toContain("404");
  });

  it("removes a track from a collection and logs it", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("Removal");
    const trackId = await suite.mkTrack("Leaving");
    const token = await mintMcpToken(editor, ["read", "write"]);
    await callTool(token, "add_tracks_to_collection", {
      collectionId,
      trackIds: [trackId],
    });

    const res = await callTool(token, "remove_track_from_collection", {
      collectionId,
      trackId,
    });
    expect(rowFrom(res).trackId).toBe(trackId);

    const tracks = await callTool(token, "list_collection_tracks", {
      collectionId,
    });
    expect(rowFrom(tracks).tracks).toEqual([]);
    const activity = await latestActivity("collection", collectionId);
    expect(activity?.changes?.tracks).toEqual({ from: ["Leaving"], to: [] });
  });

  it("swaps two tracks when the number is already taken, and logs the order", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("Ordering");
    const a = await suite.mkTrack("Order A");
    const b = await suite.mkTrack("Order B");
    const token = await mintMcpToken(editor, ["read", "write"]);
    await callTool(token, "add_tracks_to_collection", {
      collectionId,
      trackIds: [a, b],
    });
    await callTool(token, "set_track_number", {
      collectionId,
      trackId: a,
      trackNumber: 1,
    });
    await callTool(token, "set_track_number", {
      collectionId,
      trackId: b,
      trackNumber: 2,
    });

    const res = await callTool(token, "set_track_number", {
      collectionId,
      trackId: b,
      trackNumber: 1,
    });
    const numbers = new Map(
      (rowFrom(res).tracks as CollectionTrack[]).map((t) => [
        t.id,
        t.trackNumber,
      ])
    );
    expect(numbers.get(b)).toBe(1);
    expect(numbers.get(a)).toBe(2);

    const activity = await latestActivity("collection", collectionId);
    expect(activity?.changes?.trackOrder).toEqual({
      from: ["Order A", "Order B"],
      to: ["Order B", "Order A"],
    });
  });
});

type SessionRow = { id: number; trackId: number | null; main: boolean };

describe("link_sessions", () => {
  it("makes a session main, clearing the track's previous main, and logs it", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Linked");
    const previous = await suite.mkSession({ trackId, main: true });
    const next = await suite.mkSession({ name: "Next" });
    const token = await mintMcpToken(editor, ["read", "write"]);

    const res = await callTool(token, "link_sessions", {
      moves: [{ sessionId: next.id, trackId, main: true }],
    });
    expect(rowFrom(res).moved).toBe(1);

    const listed = await callTool(token, "list_track_sessions", { trackId });
    const byId = new Map(
      (rowFrom(listed).sessions as SessionRow[]).map((s) => [s.id, s])
    );
    expect(byId.get(next.id)?.main).toBe(true);
    expect(byId.get(previous.id)?.main).toBe(false);

    const activity = await latestActivity("session", next.id);
    expect(activity?.action).toBe("updated");
    expect(activity?.changes).toEqual({
      trackId: { from: null, to: trackId },
      main: { from: false, to: true },
    });
  });

  it("writes nothing for an empty move list", async () => {
    suite.requireProject();
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "link_sessions", { moves: [] });
    expect(rowFrom(res).moved).toBe(0);
  });

  it("answers 404 for a track from another project", async () => {
    suite.requireProject();
    const session = await suite.mkSession({ name: "Stays home" });
    const other = await suite.throwawayProject();
    const foreignId = await foreignTrack(other);
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "link_sessions", {
      moves: [{ sessionId: session.id, trackId: foreignId, main: false }],
    });
    expect(errorText(res)).toContain("404");
  });

  it("rejects the eleventh call in a burst with 429", async () => {
    suite.requireProject();
    // A throwaway project's editor draws on a bucket no other test touches.
    const other = await suite.throwawayProject("Link burst");
    const session = await suite.mkSession(
      { name: "Burst", projectId: other.id },
      other.owner.cookie
    );
    const token = await mintMcpToken(other.editor, ["read", "write"]);
    const move = { sessionId: session.id, trackId: null, main: false };

    // Held still so the bucket cannot refill between calls on a slow runner.
    setSystemTime(new Date());
    const results: ToolResult[] = [];
    try {
      for (let i = 0; i < 11; i += 1) {
        results.push(await callTool(token, "link_sessions", { moves: [move] }));
      }
    } finally {
      setSystemTime();
    }
    expect(resultOf(results[9]!)?.isError).toBeUndefined();
    expect(errorText(results[10]!)).toContain("429");
  });
});

type RelationRow = {
  id: number;
  fromTrackId: number;
  toTrackId: number;
  relationType: { id: number; name: string };
};

describe("track relations", () => {
  it("adds and removes a relation named by its type, logging both on the derivative", async () => {
    suite.requireProject();
    const source = await suite.mkTrack("Original");
    const remix = await suite.mkTrack("Remix");
    const token = await mintMcpToken(editor, ["read", "write"]);

    const added = await callTool(token, "add_track_relation", {
      fromTrackId: remix,
      toTrackId: source,
      relation: "remix",
    });
    const relation = rowFrom(added) as unknown as RelationRow;
    expect(relation.fromTrackId).toBe(remix);
    expect(relation.toTrackId).toBe(source);
    expect(relation.relationType).toEqual({
      id: (await relationTypeByName(suite.projectId, "remix"))!.id,
      name: "remix",
    });
    const addActivity = await latestActivity("track", remix);
    expect(addActivity?.changes?.relations?.from).toEqual([]);
    expect(addActivity?.changes?.relations?.to).toEqual([
      expect.stringMatching(/^remix of Original/),
    ]);

    const removed = await callTool(token, "remove_track_relation", {
      trackId: source,
      relationId: relation.id,
    });
    expect(rowFrom(removed).id).toBe(relation.id);
    const removeActivity = await latestActivity("track", remix);
    expect(removeActivity?.changes?.relations?.to).toEqual([]);
  });

  it("answers 404 for a toTrackId from another project", async () => {
    suite.requireProject();
    const remix = await suite.mkTrack("Remix of foreign");
    const other = await suite.throwawayProject();
    const foreignId = await foreignTrack(other);
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "add_track_relation", {
      fromTrackId: remix,
      toTrackId: foreignId,
      relation: "remix",
    });
    expect(errorText(res)).toContain("404");
  });

  it("answers 404 for a type name the project's list does not have", async () => {
    suite.requireProject();
    const source = await suite.mkTrack("Unnamed type source");
    const version = await suite.mkTrack("Unnamed type version");
    const token = await mintMcpToken(editor, ["read", "write"]);
    const res = await callTool(token, "add_track_relation", {
      fromTrackId: version,
      toTrackId: source,
      relation: "bootleg of",
    });
    expect(errorText(res)).toContain("404");
    expect(errorText(res)).toContain('No relation type named "bootleg of"');
  });

  it("bulk-updates only the tracks a relation filter names by type", async () => {
    suite.requireProject();
    const source = await suite.mkTrack("Bulk relation source");
    const cover = await suite.mkTrack("Bulk relation cover");
    const bystander = await suite.mkTrack("Bulk relation bystander");
    const token = await mintMcpToken(editor, ["read", "write"]);
    await callTool(token, "add_track_relation", {
      fromTrackId: cover,
      toTrackId: source,
      relation: "cover",
    });

    const res = await callTool(token, "bulk_update", {
      kind: "track",
      projectId: suite.projectId,
      selection: { all: true, relation: "cover" },
      patch: { explicit: true },
    });
    expect(rowFrom(res).updated).toBe(2);
    expect(await explicitOf(cover)).toBe(true);
    expect(await explicitOf(source)).toBe(true);
    expect(await explicitOf(bystander)).toBe(false);
  });
});

/** Whether a track is marked explicit, read back through its detail route. */
async function explicitOf(trackId: number): Promise<boolean> {
  const res = await suite.request("owner", `/tracks/${trackId}`);
  return ((await res.json()) as { explicit: boolean }).explicit;
}

describe("move_to_project", () => {
  it("moves a track into another project and logs it on both sides", async () => {
    suite.requireProject();
    const other = await suite.throwawayProject("Move target");
    await suite.seedMember(other.editor, "editor");
    const trackId = await suite.mkTrack("Travelling");
    const token = await mintMcpToken(other.editor, ["read", "write"]);

    const res = await callTool(token, "move_to_project", {
      kind: "track",
      id: trackId,
      projectId: other.id,
    });
    expect(rowFrom(res).projectId).toBe(other.id);

    const source = await latestActivity("track", trackId);
    const moved = { projectId: { from: suite.projectId, to: other.id } };
    expect(source?.changes).toEqual(moved);
    const [target] = await getProjectActivity(other.id, {
      entityType: "track",
      entityId: trackId,
    });
    expect(target?.changes).toEqual(moved);
  });

  it("answers 403 when the caller is only a viewer in the target", async () => {
    suite.requireProject();
    const other = await suite.throwawayProject("Viewer target");
    await suite.seedMember(other.editor, "viewer");
    const foreignId = await foreignTrack(other);
    const token = await mintMcpToken(other.editor, ["read", "write"]);
    const res = await callTool(token, "move_to_project", {
      kind: "track",
      id: foreignId,
      projectId: suite.projectId,
    });
    expect(errorText(res)).toContain("403");
  });

  it("rejects the eleventh move in a burst with 429", async () => {
    suite.requireProject();
    // Every move is refused by the target check after spending its token, so
    // the burst is cheap and the bucket belongs to this test's actor alone.
    const other = await suite.throwawayProject("Move burst");
    await suite.seedMember(other.editor, "viewer");
    const foreignId = await foreignTrack(other);
    const token = await mintMcpToken(other.editor, ["read", "write"]);
    const args = { kind: "track", id: foreignId, projectId: suite.projectId };

    setSystemTime(new Date());
    const results: ToolResult[] = [];
    try {
      for (let i = 0; i < 11; i += 1) {
        results.push(await callTool(token, "move_to_project", args));
      }
    } finally {
      setSystemTime();
    }
    expect(errorText(results[9]!)).toContain("403");
    expect(errorText(results[10]!)).toContain("429");
  });
});

/** Reads a track or collection's label names through its HTTP detail route. */
async function labelNamesOf(
  kind: "track" | "collection",
  id: number
): Promise<string[]> {
  const path = kind === "track" ? `/tracks/${id}` : `/collections/${id}`;
  const res = await suite.request("owner", path);
  const body = (await res.json()) as { labels: { name: string }[] };
  return body.labels.map((l) => l.name).sort();
}

/** Whether a tool call failed via JSON-RPC error or MCP `isError`. */
function expectToolRejected(res: ToolResult): string {
  const body = res.body as ToolResultBody & {
    error?: { code: number; message: string };
  };
  if (body.error) return body.error.message;
  expect(body.result?.isError).toBe(true);
  return body.result?.content?.[0]?.text ?? "";
}

describe("image rejection on entity writes", () => {
  it("omits image from create/update schemas and documents set_cover/remove_cover", async () => {
    suite.requireProject();
    const token = await mintMcpToken(owner, ["read", "write"]);
    const tools = await listTools(token);
    const byName = new Map(tools.map((t) => [t.name, t]));

    for (const name of [
      "create_track",
      "create_collection",
      "update_track",
      "update_collection",
      "update_project",
    ]) {
      const tool = byName.get(name);
      expect(tool).toBeDefined();
      const props = (tool!.inputSchema.properties ?? {}) as Record<
        string,
        unknown
      >;
      expect("image" in props).toBe(false);
      expect(tool!.description).toContain("set_cover");
      expect(tool!.description).toContain("remove_cover");
    }
  });

  it("rejects passing image to update_track, update_collection, update_project, create_track and bulk_update", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("No direct image");
    const collectionId = await suite.mkCollection("No direct image col");
    const token = await mintMcpToken(owner, ["read", "write"]);

    for (const [tool, args] of [
      ["update_track", { id: trackId, image: "https://example.com/a.png" }],
      [
        "update_collection",
        { id: collectionId, image: "https://example.com/b.png" },
      ],
      [
        "update_project",
        { id: suite.projectId, image: "https://example.com/c.png" },
      ],
      [
        "create_track",
        {
          title: "With Image",
          projectId: suite.projectId,
          image: "https://example.com/d.png",
        },
      ],
      [
        "bulk_update",
        {
          kind: "track",
          projectId: suite.projectId,
          selection: { ids: [trackId] },
          patch: { image: "https://example.com/e.png" },
        },
      ],
    ] as const) {
      const res = await callTool(token, tool, { ...args });
      const msg = expectToolRejected(res);
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

describe("set_collection_order", () => {
  it("adds missing tracks and sequences 1..N atomically without colliding on existing numbers", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("Atomic Order");
    const a = await suite.mkTrack("Seq A");
    const b = await suite.mkTrack("Seq B");
    const c = await suite.mkTrack("Seq C");
    const d = await suite.mkTrack("Seq D");
    const token = await mintMcpToken(owner, ["read", "write"]);

    const first = await callTool(token, "set_collection_order", {
      collectionId,
      trackIds: [a, b, c],
    });
    expect(rowFrom(first)).toEqual({
      collectionId,
      count: 3,
      tracks: [
        { trackId: a, title: "Seq A", trackNumber: 1 },
        { trackId: b, title: "Seq B", trackNumber: 2 },
        { trackId: c, title: "Seq C", trackNumber: 3 },
      ],
    });

    // Reverse existing tracks + add missing track `d` + omit `b` (left unnumbered).
    const second = await callTool(token, "set_collection_order", {
      collectionId,
      trackIds: [c, d, a],
    });
    expect(rowFrom(second)).toEqual({
      collectionId,
      count: 4,
      tracks: [
        { trackId: c, title: "Seq C", trackNumber: 1 },
        { trackId: d, title: "Seq D", trackNumber: 2 },
        { trackId: a, title: "Seq A", trackNumber: 3 },
        { trackId: b, title: "Seq B", trackNumber: null },
      ],
    });

    const activity = await latestActivity("collection", collectionId);
    expect(activity?.action).toBe("updated");
    expect(activity?.changes?.trackOrder?.to).toEqual([
      "Seq C",
      "Seq D",
      "Seq A",
      "Seq B",
    ]);
  });

  it("rejects duplicate trackIds with 400 and foreign trackIds with 404", async () => {
    suite.requireProject();
    const collectionId = await suite.mkCollection("Order validation");
    const a = await suite.mkTrack("Order Valid A");
    const other = await suite.throwawayProject();
    const foreignId = await foreignTrack(other);
    const token = await mintMcpToken(owner, ["read", "write"]);

    const dup = await callTool(token, "set_collection_order", {
      collectionId,
      trackIds: [a, a],
    });
    expect(errorText(dup)).toContain("400");

    const foreign = await callTool(token, "set_collection_order", {
      collectionId,
      trackIds: [a, foreignId],
    });
    expect(errorText(foreign)).toContain("404");
  });
});

describe("inline labels on create, update and bulk_update", () => {
  it("sets initial labels on create_track and create_collection", async () => {
    suite.requireProject();
    const token = await mintMcpToken(owner, ["read", "write"]);

    const track = rowFrom(
      await callTool(token, "create_track", {
        title: "Inline Label Track",
        projectId: suite.projectId,
        labels: ["Inline Alpha", "Inline Beta"],
      })
    );
    expect(await labelNamesOf("track", track.id as number)).toEqual([
      "Inline Alpha",
      "Inline Beta",
    ]);

    const col = rowFrom(
      await callTool(token, "create_collection", {
        title: "Inline Label Collection",
        projectId: suite.projectId,
        labels: ["Inline Beta", "Inline Gamma"],
      })
    );
    expect(await labelNamesOf("collection", col.id as number)).toEqual([
      "Inline Beta",
      "Inline Gamma",
    ]);
  });

  it("supports addLabels, removeLabels and labels replacement on update_track and update_collection", async () => {
    suite.requireProject();
    const trackId = await suite.mkTrack("Patch Labels Track");
    const colId = await suite.mkCollection("Patch Labels Collection");
    const token = await mintMcpToken(owner, ["read", "write"]);

    await callTool(token, "update_track", {
      id: trackId,
      title: "Patch Labels Track v2",
      addLabels: ["Synth", "Vocals"],
    });
    expect(await labelNamesOf("track", trackId)).toEqual(["Synth", "Vocals"]);

    // Label-only update with addLabels + removeLabels.
    await callTool(token, "update_track", {
      id: trackId,
      addLabels: ["Mastered"],
      removeLabels: ["Synth"],
    });
    expect(await labelNamesOf("track", trackId)).toEqual([
      "Mastered",
      "Vocals",
    ]);

    // Full replace with `labels`.
    await callTool(token, "update_track", {
      id: trackId,
      labels: ["Final"],
    });
    expect(await labelNamesOf("track", trackId)).toEqual(["Final"]);

    // Collection inline label update.
    await callTool(token, "update_collection", {
      id: colId,
      addLabels: ["LP"],
    });
    expect(await labelNamesOf("collection", colId)).toEqual(["LP"]);

    // Combining `labels` with `addLabels` or `removeLabels` fails with 400.
    const conflict = await callTool(token, "update_track", {
      id: trackId,
      labels: ["Final"],
      addLabels: ["Extra"],
    });
    expect(errorText(conflict)).toContain("400");
  });

  it("supports labels, addLabels and removeLabels on bulk_update", async () => {
    suite.requireProject();
    const a = await suite.mkTrack("Bulk Label A");
    const b = await suite.mkTrack("Bulk Label B");
    const token = await mintMcpToken(owner, ["read", "write"]);

    const added = await callTool(token, "bulk_update", {
      kind: "track",
      projectId: suite.projectId,
      selection: { ids: [a, b] },
      patch: { priority: "Medium" },
      addLabels: ["Bulk Tag 1", "Bulk Tag 2"],
    });
    expect(rowFrom(added).updated).toBe(2);
    expect(await priorityNameOf(a)).toBe("Medium");
    expect(await labelNamesOf("track", a)).toEqual([
      "Bulk Tag 1",
      "Bulk Tag 2",
    ]);
    expect(await labelNamesOf("track", b)).toEqual([
      "Bulk Tag 1",
      "Bulk Tag 2",
    ]);

    // Label-only bulk_update (removing one, adding a new one).
    const adjusted = await callTool(token, "bulk_update", {
      kind: "track",
      projectId: suite.projectId,
      selection: { ids: [a, b] },
      addLabels: ["Bulk Tag 3"],
      removeLabels: ["Bulk Tag 1"],
    });
    expect(rowFrom(adjusted).updated).toBe(2);
    expect(await labelNamesOf("track", a)).toEqual([
      "Bulk Tag 2",
      "Bulk Tag 3",
    ]);

    // Replace via `patch.labels`.
    const replaced = await callTool(token, "bulk_update", {
      kind: "track",
      projectId: suite.projectId,
      selection: { ids: [a] },
      patch: { labels: ["Bulk Only"] },
    });
    expect(rowFrom(replaced).updated).toBe(1);
    expect(await labelNamesOf("track", a)).toEqual(["Bulk Only"]);
    expect(await labelNamesOf("track", b)).toEqual([
      "Bulk Tag 2",
      "Bulk Tag 3",
    ]);
  });
});

describe("batch_update_tracks", () => {
  it("applies heterogeneous patches, labels, notes and lyrics in one call", async () => {
    suite.requireProject();
    const a = await suite.mkTrack("Batch A");
    const b = await suite.mkTrack("Batch B");
    const token = await mintMcpToken(owner, ["read", "write"]);

    const res = await callTool(token, "batch_update_tracks", {
      projectId: suite.projectId,
      updates: [
        {
          id: a,
          title: "Batch A Updated",
          priority: "Urgent",
          labels: ["Batch One"],
          notes: "Kick needs more punch",
          lyrics: "[Verse 1]\nNeon skyline fading",
        },
        {
          id: b,
          explicit: true,
          addLabels: ["Batch Two"],
          notes: "Check outro fade",
        },
      ],
    });
    expect(rowFrom(res)).toEqual({ updated: 2, trackIds: [a, b] });

    const detailA = await suite.request("owner", `/tracks/${a}`);
    const bodyA = (await detailA.json()) as {
      title: string;
      priority: { name: string };
      labels: { name: string }[];
    };
    expect(bodyA.title).toBe("Batch A Updated");
    expect(bodyA.priority.name).toBe("Urgent");
    expect(bodyA.labels.map((l) => l.name)).toEqual(["Batch One"]);

    const notesA = rowFrom(
      await callTool(token, "read_notes", { kind: "track", id: a })
    );
    expect(notesA.markdown).toContain("Kick needs more punch");
    const lyricsA = rowFrom(
      await callTool(token, "read_lyrics", { trackId: a })
    );
    expect(lyricsA.markdown).toContain("Neon skyline fading");

    expect(await explicitOf(b)).toBe(true);
    expect(await labelNamesOf("track", b)).toEqual(["Batch Two"]);
    const notesB = rowFrom(
      await callTool(token, "read_notes", { kind: "track", id: b })
    );
    expect(notesB.markdown).toContain("Check outro fade");
  });

  it("rejects duplicate ids, cross-project tracks, image fields and conflicting label flags", async () => {
    suite.requireProject();
    const a = await suite.mkTrack("Batch Guard A");
    const other = await suite.throwawayProject();
    const foreignId = await foreignTrack(other);
    const token = await mintMcpToken(owner, ["read", "write"]);

    const dup = await callTool(token, "batch_update_tracks", {
      projectId: suite.projectId,
      updates: [
        { id: a, title: "One" },
        { id: a, title: "Two" },
      ],
    });
    expect(errorText(dup)).toContain("400");

    const foreign = await callTool(token, "batch_update_tracks", {
      projectId: suite.projectId,
      updates: [
        { id: a, title: "Should not apply" },
        { id: foreignId, title: "Foreign" },
      ],
    });
    expect(errorText(foreign)).toContain("404");

    const withImage = await callTool(token, "batch_update_tracks", {
      projectId: suite.projectId,
      updates: [{ id: a, image: "https://example.com/nope.png" }],
    });
    expect(expectToolRejected(withImage).length).toBeGreaterThan(0);

    const conflictLabels = await callTool(token, "batch_update_tracks", {
      projectId: suite.projectId,
      updates: [{ id: a, labels: ["X"], addLabels: ["Y"] }],
    });
    expect(errorText(conflictLabels)).toContain("400");
  });
});

describe("create_label and update_label", () => {
  it("creates a label with colourHex, updates it, and enforces uniqueness and required fields", async () => {
    suite.requireProject();
    const token = await mintMcpToken(owner, ["read", "write"]);

    const created = rowFrom(
      await callTool(token, "create_label", {
        projectId: suite.projectId,
        name: "Coloured Label",
        colourHex: "#ff5500",
      })
    );
    expect(created.name).toBe("Coloured Label");
    expect(created.colourHex).toBe("#ff5500");

    // Duplicate name fails with 409.
    const dup = await callTool(token, "create_label", {
      projectId: suite.projectId,
      name: "Coloured Label",
    });
    expect(errorText(dup)).toContain("409");

    const updated = rowFrom(
      await callTool(token, "update_label", {
        projectId: suite.projectId,
        labelId: created.id as number,
        name: "Renamed Label",
        colourHex: "#00aa88",
      })
    );
    expect(updated.name).toBe("Renamed Label");
    expect(updated.colourHex).toBe("#00aa88");

    // Neither name nor colourHex fails validation.
    const empty = await callTool(token, "update_label", {
      projectId: suite.projectId,
      labelId: created.id as number,
    });
    expect(expectToolRejected(empty).length).toBeGreaterThan(0);
  });
});
