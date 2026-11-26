import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import { beforeAll, describe, expect, it } from "bun:test";
import type { z } from "zod";
import { entityModules } from "../src/entities/index.js";
import {
  buildEnumsSource,
  buildOpenApiDocument,
  FILTER_PARAMS,
} from "./generate-api.js";

type Operation = { operationId?: unknown; tags?: unknown; summary?: unknown };

/**
 * A summary is what a reference lists an operation by, so it has to read as a
 * label: short, and plain text rather than inline code.
 */
const SUMMARY_MAX_LENGTH = 60;
type PathItem = Record<string, Operation | unknown>;

const METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "patch",
  "options",
  "head",
  "trace",
] as const;

/**
 * The prefixes every client and the scanner call. Until the entity registry
 * exists, this is the hand-kept stand-in for iterating its mount paths.
 */
const MOUNTS = [
  "/api/projects",
  "/api/collections",
  "/api/tracks",
  "/api/sessions",
  "/api/comments",
  "/api/images",
  "/api/assets",
  "/api/statuses",
];

describe("the generated OpenAPI document", () => {
  let document: Record<string, unknown>;
  let paths: Record<string, PathItem>;

  beforeAll(async () => {
    document = await buildOpenApiDocument();
    paths = document.paths as Record<string, PathItem>;
  });

  const operations = (): { path: string; method: string; op: Operation }[] =>
    Object.entries(paths).flatMap(([path, item]) =>
      METHODS.filter((method) => item[method]).map((method) => ({
        path,
        method,
        op: item[method] as Operation,
      }))
    );

  it("is a document with an info block and paths", () => {
    expect(document.openapi).toEqual(expect.any(String));
    expect(document.info).toMatchObject({ title: expect.any(String) });
    expect(Object.keys(paths).length).toBeGreaterThan(0);
  });

  it("gives every route an operationId", () => {
    const missing = operations()
      .filter(({ op }) => typeof op.operationId !== "string" || !op.operationId)
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(missing).toEqual([]);
  });

  it("gives no two routes the same operationId", () => {
    const seen = new Map<string, string[]>();
    for (const { path, method, op } of operations()) {
      const id = String(op.operationId);
      seen.set(id, [
        ...(seen.get(id) ?? []),
        `${method.toUpperCase()} ${path}`,
      ]);
    }
    const collisions = Object.fromEntries(
      [...seen].filter(([, routes]) => routes.length > 1)
    );
    expect(collisions).toEqual({});
  });

  it("files every route under one group", () => {
    const untagged = operations()
      .filter(
        ({ op }) =>
          !Array.isArray(op.tags) ||
          op.tags.length !== 1 ||
          typeof op.tags[0] !== "string"
      )
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(untagged).toEqual([]);
  });

  it("summarises every route in a short, plain label", () => {
    const unreadable = operations()
      .filter(
        ({ op }) =>
          typeof op.summary !== "string" ||
          op.summary.length === 0 ||
          op.summary.length > SUMMARY_MAX_LENGTH ||
          op.summary.includes("`")
      )
      .map(
        ({ method, path, op }) =>
          `${method.toUpperCase()} ${path}: ${String(op.summary)}`
      );
    expect(unreadable).toEqual([]);
  });

  it("documents every mounted router", () => {
    const undocumented = MOUNTS.filter(
      (mount) => !Object.keys(paths).some((path) => path.startsWith(mount))
    );
    expect(undocumented).toEqual([]);
  });
});

describe("the generated enums", () => {
  it("emits a const array and a type alias per enum", () => {
    const source = buildEnumsSource();
    expect(source).toContain("do not edit by hand");
    expect(source).toContain(
      'export const MEMBER_ROLES = [\n  "owner",\n  "admin",\n  "editor",\n  "viewer",\n] as const;'
    );
    expect(source).toContain(
      "export type MemberRole = (typeof MEMBER_ROLES)[number];"
    );
  });

  it("emits every listing's filter params, each one a param its paginated route takes", () => {
    const source = buildEnumsSource();
    const listed = entityModules().flatMap((m) => (m.list ? [m] : []));
    expect(FILTER_PARAMS.map((list) => list.name)).toEqual(
      listed.map((m) => `${m.kind.toUpperCase()}_FILTER_PARAMS`)
    );
    for (const { list } of listed) {
      const params = Object.keys((list!.querySchema as z.ZodObject).shape);
      expect(params).toEqual(expect.arrayContaining([...list!.filterParams]));
    }
    expect(source).toContain(
      "export type TrackFilterParam = (typeof TRACK_FILTER_PARAMS)[number];"
    );
    expect(
      FILTER_PARAMS.find((list) => list.name === "TRACK_FILTER_PARAMS")?.values
    ).toContain("explicit");
  });

  it("matches the committed packages/api/src/enums.ts", async () => {
    const filePath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../../../packages/api/src/enums.ts"
    );
    const config = await resolveConfig(filePath);
    const expected = await format(buildEnumsSource(), {
      ...config,
      filepath: filePath,
    });

    expect(await readFile(filePath, "utf8")).toEqual(expected);
  });
});
