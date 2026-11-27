import {
  createMcpHandler,
  McpServer,
  ResourceTemplate,
  type McpHttpHandler,
  type StandardSchemaWithJSON,
  type Variables,
} from "@modelcontextprotocol/server";
import { z, type ZodType } from "zod";
import { instancePolicy } from "../lib/instance-policy.js";
import { actorFrom, type Actor, type Scope } from "./actor.js";
import { requireScope, toolFailure } from "./authorize.js";
import { RESOURCES } from "./resources/index.js";
import type { AnyToolSpec, ResourceSpec } from "./spec.js";
import { TOOLS } from "./tools/index.js";

/** A template variable's first value, since every one of this registry's templates binds a single id. */
function toParams(variables: Variables): Record<string, string> {
  return Object.fromEntries(
    Object.entries(variables).map(([key, value]) => [
      key,
      Array.isArray(value) ? (value[0] ?? "") : value,
    ])
  );
}

const CUSTOM_FIELD_KEY = /^cf_\d+$/;

/**
 * Server-level guidance advertised on MCP discovery and initialization so
 * agents avoid common footguns (wrong filter names, N+1 loops, oversized
 * session structure payloads, or writing artwork via entity patches).
 */
const MCP_INSTRUCTIONS = [
  "Projammr manages music projects (tracks, collections, DAW sessions, notes, lyrics, artwork, audio versions).",
  "- Call `get_project` first to read the project's statuses, priority scale, relation types, labels, and custom fields (`cf_<id>`).",
  "- `list_tracks` filter names are `status`, `priority`, `collection`, `relation`, `label`, `artist`, `explicit`, plus audit booleans `unlabeled`, `uncollected`, `hasNotes`, `hasLyrics`, `hasImage`, `hasAudio`, `hasSessions`, and custom fields `cf_<id>`.",
  "- Pass `compact: true` on `list_tracks` for slim pages (ids, names, flags, counts) when scanning a catalogue.",
  "- `list_sessions` and `list_track_sessions` omit DAW `structure` by default; pass `includeStructure: true` on `list_track_sessions` or call `get_session` when you need device/track trees.",
  "- `list_repos` returns `setCount` by default and omits `sets`; pass `includeSets: true` to include adopted sets and branch tips.",
  "- Cover artwork is changed only via `set_cover` (`url`, `imageId`, or base64 `data`) and `remove_cover` — never via `update_track`, `update_collection`, or `update_project`.",
  "- Prefer batch tools over N+1 loops: `batch_update_tracks`, `bulk_update`, `set_collection_order`, `link_sessions`, `append_notes`, `update_label`, and inline `labels`/`addLabels`/`removeLabels` on track/collection writes.",
  "- Use the `dit` CLI for local DAW project scanning/backfills and large audio uploads; use MCP for metadata, notes, lyrics, artwork, and catalogue organisation.",
].join("\n");

type AllowedKeysInfo = {
  keys: Set<string>;
  allowsCustomFields: boolean;
};

/**
 * Extracts the top-level keys an input schema recognises, and whether it is a
 * `.loose()` / catchall schema (used by `list_tracks` and `list_collections`
 * for `cf_<id>` custom-field filters). Returns `null` for non-object schemas
 * where top-level key checking does not apply.
 */
function inspectInputKeys(schema: ZodType): AllowedKeysInfo | null {
  const def = schema._zod.def as {
    type: string;
    shape?: Record<string, ZodType>;
    catchall?: ZodType;
    left?: ZodType;
    right?: ZodType;
    options?: ZodType[];
    in?: ZodType;
    innerType?: ZodType;
  };

  switch (def.type) {
    case "object": {
      const catchallType = def.catchall?._zod.def.type;
      return {
        keys: new Set(Object.keys(def.shape ?? {})),
        allowsCustomFields:
          catchallType !== undefined && catchallType !== "never",
      };
    }
    case "intersection": {
      const left = def.left ? inspectInputKeys(def.left) : null;
      const right = def.right ? inspectInputKeys(def.right) : null;
      if (!left || !right) return null;
      return {
        keys: new Set([...left.keys, ...right.keys]),
        allowsCustomFields: left.allowsCustomFields || right.allowsCustomFields,
      };
    }
    case "union": {
      const options = def.options ?? [];
      if (options.length === 0) return null;
      const keys = new Set<string>();
      let allowsCustomFields = false;
      for (const option of options) {
        const info = inspectInputKeys(option);
        if (!info) return null;
        for (const key of info.keys) keys.add(key);
        allowsCustomFields = allowsCustomFields || info.allowsCustomFields;
      }
      return { keys, allowsCustomFields };
    }
    case "pipe":
      return def.in ? inspectInputKeys(def.in) : null;
    case "optional":
    case "default":
    case "catch":
    case "readonly":
      return def.innerType ? inspectInputKeys(def.innerType) : null;
    default:
      return null;
  }
}

function unknownKeysIssue(
  allowed: AllowedKeysInfo,
  value: unknown
): { issues: [{ message: string; path: string[] }] } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const unknown = Object.keys(value).filter(
    (key) =>
      !allowed.keys.has(key) &&
      !(allowed.allowsCustomFields && CUSTOM_FIELD_KEY.test(key))
  );
  if (unknown.length === 0) return null;

  const listed = unknown.map((k) => `"${k}"`).join(", ");
  const valid = [...allowed.keys].sort();
  if (allowed.allowsCustomFields) valid.push("cf_<id>");
  const hint =
    valid.length > 0
      ? `Valid keys: ${valid.join(", ")}.`
      : "This tool takes no arguments.";
  return {
    issues: [
      {
        message: `Unrecognized argument${unknown.length === 1 ? "" : "s"}: ${listed}. ${hint}`,
        path: [unknown[0]!],
      },
    ],
  };
}

/**
 * A tool schema as the client sees it on the wire. The SDK turns every tool
 * schema into JSON Schema for `tools/list`, and zod refuses to convert a
 * `Date`, so a single row schema with a timestamp would fail the whole list.
 * Tool arguments and structured results travel as JSON, where a `Date` is an
 * ISO string, so that is what the schema advertises; a field whose own
 * metadata already names its wire type (`epochDate`) keeps it. Validation
 * stays with zod: an input is checked for unrecognized top-level keys first
 * (so typos like `statusId` on `list_tracks` or `image` on `update_track`
 * fail loudly instead of silently stripping), then parsed by the tool's own
 * schema, and an output is parsed in the callback before it is serialised.
 */
function wireSchema(
  schema: ZodType,
  io: "input" | "output"
): StandardSchemaWithJSON {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    unrepresentable: "any",
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema._zod.def.type === "date" && jsonSchema.type == null) {
        jsonSchema.type = "string";
        jsonSchema.format = "date-time";
      }
    },
  });
  const allowedKeys = io === "input" ? inspectInputKeys(schema) : null;
  return {
    "~standard": {
      version: 1,
      vendor: "projammr",
      validate:
        io === "input"
          ? (value) => {
              if (allowedKeys) {
                const unknown = unknownKeysIssue(allowedKeys, value);
                if (unknown) return unknown;
              }
              return schema["~standard"].validate(value);
            }
          : (value) => ({ value }),
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

/**
 * A named tool's gating scope, looked up before the tool is dispatched. Used
 * ahead of the SDK's own `tools/call` handling, which folds an error thrown
 * from inside a tool callback into an ordinary result rather than surfacing
 * it as an HTTP-level challenge.
 */
export function toolScope(
  name: string,
  tools: readonly AnyToolSpec[] = TOOLS
): Scope | undefined {
  return tools.find((tool) => tool.name === name)?.scope;
}

/**
 * One server per request, holding the actor by closure. A tool the actor's
 * scopes do not cover, or whose scope the instance does not offer
 * (`integrations.mcpToolGroups`, read per request), is not registered at all,
 * so `tools/list` is the exact set the caller may use; within a scope set the
 * order is `tools`' own order, which keeps the list deterministic across
 * requests.
 */
function buildServer(
  actor: Actor,
  tools: readonly AnyToolSpec[] = TOOLS,
  resources: readonly ResourceSpec[] = RESOURCES
): McpServer {
  const server = new McpServer(
    { name: "projammr", version: "1" },
    { instructions: MCP_INSTRUCTIONS }
  );
  const offered = instancePolicy().integrations.mcpToolGroups;

  for (const tool of tools) {
    if (!actor.scopes.has(tool.scope) || !offered.includes(tool.scope)) {
      continue;
    }
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: wireSchema(tool.input, "input"),
        outputSchema: wireSchema(tool.output, "output"),
        annotations: {
          readOnlyHint: tool.scope === "read",
          destructiveHint: tool.destructive ?? false,
          idempotentHint: tool.idempotent ?? false,
          openWorldHint: false,
        },
      },
      async (input) => {
        let result: unknown;
        try {
          requireScope(actor, tool.scope);
          result = await tool.run(actor, input);
        } catch (err) {
          const failure = toolFailure(err);
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `${failure.status}: ${failure.message}`,
              },
            ],
          };
        }
        // Outside the failure mapping: a result that breaks its own schema is
        // a server bug, not a 400 the model should act on.
        const text = JSON.stringify(tool.output.parse(result));
        return {
          content: [{ type: "text" as const, text }],
          structuredContent: JSON.parse(text),
        };
      }
    );
  }

  for (const resource of resources) {
    const config = {
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    };
    if (resource.template.includes("{")) {
      server.registerResource(
        resource.name,
        new ResourceTemplate(resource.template, { list: undefined }),
        config,
        async (uri, variables) => ({
          contents: [
            {
              uri: uri.href,
              mimeType: resource.mimeType,
              text: await resource.read(actor, toParams(variables)),
            },
          ],
        })
      );
    } else {
      server.registerResource(
        resource.name,
        resource.template,
        config,
        async (uri) => ({
          contents: [
            {
              uri: uri.href,
              mimeType: resource.mimeType,
              text: await resource.read(actor, {}),
            },
          ],
        })
      );
    }
  }

  return server;
}

/** A fresh stateless handler over `tools`/`resources`, one `McpServer` per request. */
export function createMcpHandlerFor(
  tools: readonly AnyToolSpec[] = TOOLS,
  resources: readonly ResourceSpec[] = RESOURCES
): McpHttpHandler {
  return createMcpHandler(
    (ctx) => buildServer(actorFrom(ctx.authInfo), tools, resources),
    { legacy: "reject" }
  );
}
