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

/**
 * A tool schema as the client sees it on the wire. The SDK turns every tool
 * schema into JSON Schema for `tools/list`, and zod refuses to convert a
 * `Date`, so a single row schema with a timestamp would fail the whole list.
 * Tool arguments and structured results travel as JSON, where a `Date` is an
 * ISO string, so that is what the schema advertises; a field whose own
 * metadata already names its wire type (`epochDate`) keeps it. Validation
 * stays with zod: an input is parsed by the tool's own schema, and an output
 * is parsed in the callback before it is serialised.
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
  return {
    "~standard": {
      version: 1,
      vendor: "projammr",
      validate:
        io === "input"
          ? (value) => schema["~standard"].validate(value)
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
  const server = new McpServer({ name: "projammr", version: "1" });
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
