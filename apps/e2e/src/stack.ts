/**
 * Brings the shipped compose stack up and down for the end-to-end checks:
 *
 *   bun apps/e2e/src/stack.ts up [--build]
 *   bun apps/e2e/src/stack.ts logs
 *   bun apps/e2e/src/stack.ts down [--images]
 *
 * Every compose call runs under the fixed project `projammr-e2e` with an env
 * file this script writes, never the repository's own `.env`, so it cannot
 * touch a stack running from a checkout (compose project `projammr`) or start
 * anything that file configures, such as a Tailscale node.
 *
 * Environment: `PROJAMMR_VERSION` picks the image tag (the tag `up --build`
 * builds defaults to `e2e`, so it never takes over the tag a running stack's
 * images carry); `E2E_HTTP_PORT` and `E2E_HTTPS_PORT` move the proxy's host
 * ports off 80 and 443.
 */
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const PROJECT = "projammr-e2e";
const BUILT_TAG = "e2e";

const repoRoot = resolve(import.meta.dir, "../../..");
const stackDir = resolve(import.meta.dir, "../.stack");
const envFile = join(stackDir, "stack.env");
const caFile = join(stackDir, "ca.crt");

const CA_ATTEMPTS = 30;
const PEM_HEADER = "-----BEGIN CERTIFICATE-----";

const secrets = ["BETTER_AUTH_SECRET", "NOTES_MASTER_KEY"] as const;

/** Compose reads the file's `KEY=value` lines; a value may hold `=`. */
function parseEnv(text: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) entries.set(line.slice(0, at), line.slice(at + 1));
  }
  return entries;
}

async function readEnvFile(): Promise<Map<string, string> | null> {
  const file = Bun.file(envFile);
  return (await file.exists()) ? parseEnv(await file.text()) : null;
}

/**
 * The stack's env file. Secrets already in the file are kept, so an `up` over
 * a running stack does not lock the API out of the notes it wrapped.
 */
async function writeEnvFile(build: boolean): Promise<Map<string, string>> {
  const previous = (await readEnvFile()) ?? new Map<string, string>();
  const entries = new Map<string, string>();
  for (const name of secrets) {
    entries.set(name, previous.get(name) ?? randomBytes(32).toString("base64"));
  }
  entries.set("PUBLIC_HOST", "localhost");
  entries.set("MIGRATE_BACKUP", "0");

  const version = process.env.PROJAMMR_VERSION || (build ? BUILT_TAG : "");
  if (version) entries.set("PROJAMMR_VERSION", version);
  for (const name of ["E2E_HTTP_PORT", "E2E_HTTPS_PORT"]) {
    const value = process.env[name];
    if (value) entries.set(name, value);
  }
  // A page served from a remapped port sends that port in its `Origin`, and
  // the API's cross-site check for form posts accepts only the origins it is
  // configured with (the list replaces the `CLIENT_URL` default, so it names
  // both).
  const httpsPort = entries.get("E2E_HTTPS_PORT");
  if (httpsPort && httpsPort !== "443") {
    entries.set(
      "TRUSTED_ORIGINS",
      `https://localhost,https://localhost:${httpsPort}`
    );
  }

  await mkdir(stackDir, { recursive: true });
  await Bun.write(
    envFile,
    [...entries].map(([key, value]) => `${key}=${value}`).join("\n") + "\n"
  );
  return entries;
}

/**
 * Only what the docker CLI needs to find its daemon and run. Compose lets a
 * shell variable outrank the env file, so anything else inherited (a
 * `PUBLIC_HOST` or `COMPOSE_FILE` exported for another stack) would reconfigure
 * this one.
 */
const INHERITED_ENV =
  /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TERM|LANG|LC_\w+|DOCKER_\w+|BUILDX_\w+|BUILDKIT_\w+|XDG_\w+|SSL_CERT_\w+|(https?|no)_proxy)$/i;

function composeEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && INHERITED_ENV.test(entry[0])
    )
  );
}

function composeCommand(args: string[], build: boolean): string[] {
  const files = [
    "docker-compose.yml",
    ...(build ? ["docker-compose.build.yml"] : []),
    "apps/e2e/docker-compose.e2e.yml",
  ];
  return [
    "docker",
    "compose",
    "-p",
    PROJECT,
    "--env-file",
    envFile,
    ...files.flatMap((file) => ["-f", file]),
    ...args,
  ];
}

async function compose(args: string[], build: boolean): Promise<number> {
  const child = Bun.spawn(composeCommand(args, build), {
    cwd: repoRoot,
    env: composeEnv(),
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function composeOutput(args: string[], build: boolean): Promise<string> {
  const child = Bun.spawn(composeCommand(args, build), {
    cwd: repoRoot,
    env: composeEnv(),
    stdout: "pipe",
    stderr: "inherit",
  });
  const [text, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`docker compose exited with ${code}`);
  return text;
}

/** The proxy's local CA, which signs the certificate the stack serves. */
async function fetchCa(httpPort: string): Promise<void> {
  const url = `http://localhost:${httpPort}/ca.crt`;
  let lastError = "no answer";
  for (let attempt = 0; attempt < CA_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok && body.startsWith(PEM_HEADER)) {
        await Bun.write(caFile, body);
        return;
      }
      lastError = `${response.status} without a certificate`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(1000);
  }
  throw new Error(`could not fetch the proxy's CA from ${url}: ${lastError}`);
}

async function up(build: boolean): Promise<number> {
  const entries = await writeEnvFile(build);
  const code = await compose(
    ["up", "-d", "--wait", ...(build ? ["--build"] : [])],
    build
  );
  if (code !== 0) return code;
  await fetchCa(entries.get("E2E_HTTP_PORT") ?? "80");
  console.log(`stack up; CA written to ${caFile}`);
  return 0;
}

/** The images the build override builds, named as the compose files name them. */
async function builtImages(): Promise<string[]> {
  const config = JSON.parse(
    await composeOutput(["config", "--format", "json"], true)
  ) as { services: Record<string, { build?: unknown; image?: string }> };
  return Object.values(config.services)
    .filter((service) => service.build !== undefined && service.image)
    .map((service) => service.image as string);
}

async function down(removeImages: boolean): Promise<number> {
  if (!(await readEnvFile())) {
    console.log("no stack env file; nothing to bring down");
    return 0;
  }
  const images = removeImages ? await builtImages() : [];
  // A `latest` image is the tag a running stack of the same repository
  // usually holds; only a tag of this stack's own is removed.
  const shared = images.find((image) => image.endsWith(":latest"));
  if (shared) {
    console.error(
      `refusing to remove ${shared}: set PROJAMMR_VERSION to a tag of this stack's own`
    );
    return 1;
  }

  const code = await compose(["down", "-v", "--remove-orphans"], true);
  if (code !== 0) return code;
  if (images.length > 0) {
    const removal = Bun.spawn(["docker", "image", "rm", ...images], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const removed = await removal.exited;
    if (removed !== 0) return removed;
  }
  await rm(stackDir, { recursive: true, force: true });
  return 0;
}

async function logs(): Promise<number> {
  if (!(await readEnvFile())) {
    console.log("no stack env file; no logs to show");
    return 0;
  }
  return compose(["logs", "--no-color", "--tail", "200"], true);
}

const [command, ...flags] = process.argv.slice(2);
const usage = "usage: stack.ts up [--build] | down [--images] | logs";

if (command === "up" && flags.every((flag) => flag === "--build")) {
  process.exit(await up(flags.includes("--build")));
} else if (command === "logs" && flags.length === 0) {
  process.exit(await logs());
} else if (command === "down" && flags.every((flag) => flag === "--images")) {
  process.exit(await down(flags.includes("--images")));
} else {
  console.error(usage);
  process.exit(2);
}
