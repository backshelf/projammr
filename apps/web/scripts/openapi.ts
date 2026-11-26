#!/usr/bin/env bun
// Writes the API reference's two source documents, `openapi/api.json` (the
// Projammr API) and `openapi/auth.json` (Better Auth's sign-in surface), from
// the server's own in-process spec (`bun run typegen`, which the root
// `bun run typegen` also runs). They are committed so the site builds without
// the server; `test/openapi.test.ts` fails when they drift from it.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type Spec = Record<string, unknown>;

export const SPEC_FILES = {
  api: "openapi/api.json",
  auth: "openapi/auth.json",
} as const;

const INSTANCE_HOST = {
  default: "projammr.example",
  description: "The hostname your instance is served from",
};

/** The reference's name for the Projammr API. The server's own spec keeps the
 * title `PROJAMMR_API`, which the scanner identifies a server by, so only the
 * site's copy carries the readable one. */
const API_TITLE = "Projammr API";

function retitled(spec: Spec, title: string): Spec {
  return { ...spec, info: { ...(spec.info as object), title } };
}

/** A self-hosted instance serves the API from its own host, so the reference
 * names that host as a variable instead of the address the spec was built
 * on. The path its server carries stays: Better Auth's paths are relative to
 * `/api/auth`, where the Projammr API's already start with `/api`. */
function forSite(spec: Spec): Spec {
  const [built] = (spec.servers ?? []) as { url: string }[];
  const basePath = built ? new URL(built.url).pathname.replace(/\/$/, "") : "";
  return {
    ...spec,
    servers: [
      {
        url: `https://{host}${basePath}`,
        description: "Your Projammr instance",
        variables: { host: INSTANCE_HOST },
      },
    ],
  };
}

/** Both documents, built in process. Loading the server's app needs its two
 * required secrets to be set, as the Docker image's typegen stage sets them;
 * nothing here signs or decrypts anything with them. */
export async function buildSiteSpecs(): Promise<
  Record<keyof typeof SPEC_FILES, Spec>
> {
  process.env.BETTER_AUTH_SECRET ??= "openapi";
  process.env.NOTES_MASTER_KEY ??=
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  process.env.MCP_DISABLED ??= "1";

  const { buildOpenApiDocument } =
    await import("server/scripts/generate-api.js");
  const { app } = await import("server/src/app.js");

  const auth = await app.request("/api/auth/openapi");
  if (!auth.ok) {
    throw new Error(
      `GET /api/auth/openapi returned ${auth.status} ${auth.statusText}`
    );
  }

  return {
    api: retitled(forSite(await buildOpenApiDocument()), API_TITLE),
    auth: forSite((await auth.json()) as Spec),
  };
}

export function serialise(spec: Spec): string {
  return JSON.stringify(spec, null, 2) + "\n";
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const specs = await buildSiteSpecs();
  for (const [name, file] of Object.entries(SPEC_FILES)) {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, serialise(specs[name as keyof typeof SPEC_FILES]));
    console.log(`wrote ${file}`);
  }
  process.exit(0);
}
