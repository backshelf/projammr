import { describe, expect, it } from "bun:test";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import {
  composeUse,
  parseEnvExample,
} from "../src/components/docs/env-reference";

const webRoot = join(import.meta.dir, "..");
const repoRoot = join(webRoot, "..", "..");
const docsRoot = join(webRoot, "src", "content", "docs");

const readRepoFile = (file: string) => Bun.file(join(repoRoot, file)).text();
const readDocFile = (file: string) => Bun.file(join(docsRoot, file)).text();

async function docFiles(): Promise<string[]> {
  const entries = await readdir(docsRoot, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((entry) => entry.isFile() && /\.(?:mdx|md)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

describe("docs hygiene", () => {
  it("contains no retired `scanner` prose in apps/web/src/content/docs", async () => {
    const hits: string[] = [];
    for (const file of await docFiles()) {
      const lines = (await Bun.file(file).text()).split(/\r?\n/);
      const rel = relative(docsRoot, file).replaceAll("\\", "/");
      lines.forEach((line, index) => {
        if (/\bscanner\b/i.test(line)) {
          hits.push(`${rel}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("matches the server and .env.example default upload limit", async () => {
    const { DEFAULT_INSTANCE_POLICY, uploadLimitBytes } =
      await import("server/src/lib/instance-policy.js");

    const serverMb = DEFAULT_INSTANCE_POLICY.limits.maxUploadMb;
    const serverBytes = uploadLimitBytes(DEFAULT_INSTANCE_POLICY);

    const envEntries = parseEnvExample(await readRepoFile(".env.example"));
    const envVar = envEntries
      .flatMap((entry) => entry.variables)
      .find((variable) => variable.name === "MAX_UPLOAD_MB");
    expect(envVar?.value).toBe(String(serverMb));

    const compose = await readRepoFile("docker-compose.yml");
    expect(composeUse(compose, "MAX_UPLOAD_MB")).toEqual({
      kind: "default",
      value: String(serverMb),
    });

    const filesAndMedia = await readDocFile("docs/api/files-and-media.mdx");
    expect(filesAndMedia).toContain(`${serverMb} MB`);
    expect(filesAndMedia).toContain(`"maxBytes":${serverBytes}`);

    const audioVersions = await readDocFile("docs/guide/audio-versions.mdx");
    expect(audioVersions).toContain(`${serverMb} MB`);

    const artwork = await readDocFile("docs/guide/artwork.mdx");
    expect(artwork).toContain(`${serverMb} MB`);

    const relations = await readDocFile(
      "docs/guide/relations-attachments-links.mdx"
    );
    expect(relations).toContain(`${serverMb} MB`);

    const configuration = await readDocFile(
      "docs/self-hosting/configuration.mdx"
    );
    expect(configuration).toContain(`${serverMb} unless you change it`);

    const selfHosting = await readDocFile("docs/self-hosting/index.mdx");
    expect(selfHosting).toContain(`${serverMb} unless you change it`);
  });
});
