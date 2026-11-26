import { describe, expect, it } from "bun:test";
import {
  rawCommentTargetEnum,
  rawEntityKindEnum,
  rawLabelTargetEnum,
} from "../db/schema/enums.js";
import { setupSuite } from "../test/fixtures.js";
import {
  COMMENT_TARGETS,
  ENTITIES,
  entityModules,
  isEntityKind,
} from "./index.js";

const suite = setupSuite("Registry");
const { requireProject, request, mkTrack, mkCollection } = suite;

describe("entity registry", () => {
  it("the PUT status routes are gone", async () => {
    requireProject();
    const trackId = await mkTrack("Registry PUT Track");
    const collectionId = await mkCollection("Registry PUT Collection");

    const trackRes = await request("owner", `/tracks/${trackId}/status`, {
      method: "PUT",
      body: JSON.stringify({ statusId: 1 }),
    });
    expect(trackRes.status).toBe(404);

    const collectionRes = await request(
      "owner",
      `/collections/${collectionId}/status`,
      { method: "PUT", body: JSON.stringify({ statusId: 1 }) }
    );
    expect(collectionRes.status).toBe(404);
  });

  it("holds exactly the entity kinds the schema enumerates", () => {
    expect(Object.keys(ENTITIES).sort()).toEqual([...rawEntityKindEnum].sort());
    expect(entityModules()).toHaveLength(rawEntityKindEnum.length);
  });

  it("keys every module by its own kind", () => {
    for (const [key, module] of Object.entries(ENTITIES)) {
      expect<string>(module.kind).toBe(key);
    }
  });

  it("gives every module a distinct mount path", () => {
    const paths = entityModules().map((m) => m.mountPath);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) expect(path.startsWith("/")).toBe(true);
  });

  it("labels a module that carries labels with a real label target", () => {
    for (const module of entityModules()) {
      if (!module.labels) continue;
      expect(rawLabelTargetEnum).toContain(module.labels);
    }
  });

  it("covers every comment target kind", () => {
    expect(Object.keys(COMMENT_TARGETS).sort()).toEqual(
      [...rawCommentTargetEnum].sort()
    );
    for (const [kind, target] of Object.entries(COMMENT_TARGETS)) {
      expect<string>(target.kind).toBe(kind);
    }
  });

  it("names an attachment join as one of the entity's asset sources", () => {
    for (const module of entityModules()) {
      if (!module.attachments) continue;
      expect(module.assetSources).toContain(module.attachments);
      expect(module.attachments.link).toBeTypeOf("function");
    }
  });

  it("scopes every module to a project", () => {
    for (const module of entityModules()) {
      expect(module.projectColumn).toBeDefined();
      expect(module.table.id).toBeDefined();
      expect(module.nameColumn).toBeDefined();
    }
  });

  it("gives a listing both a query schema and a bulk patch schema", () => {
    for (const module of entityModules()) {
      if (!module.list) continue;
      expect(module.list.querySchema.safeParse({}).success).toBe(true);
      expect(module.list.patchSchema.safeParse({}).success).toBe(true);
      expect(module.list.sortColumns.length).toBeGreaterThan(0);
    }
  });

  it("recognises exactly the registered kinds", () => {
    for (const kind of rawEntityKindEnum) expect(isEntityKind(kind)).toBe(true);
    expect(isEntityKind("track_audio")).toBe(false);
    expect(isEntityKind("comment")).toBe(false);
  });

  it("only skips a delete record for an entity that is its own scope", () => {
    for (const module of entityModules()) {
      if (module.recordsDelete) continue;
      expect(module.projectColumn).toBe(module.table.id);
    }
  });
});
