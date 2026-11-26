/**
 * Runs `pg_dump` / `pg_restore` against a database named by a connection
 * string. A dump must be made by a client of the server's own major version,
 * so the host's tool is used when it matches and the one inside
 * `container` (the dev Postgres container) otherwise. The password travels in
 * the child's environment, never its arguments, where every local user could
 * read it from the process table.
 */
import { $, SQL } from "bun";

type Tool = "pg_dump" | "pg_restore";

function connectionEnv(url: string, inContainer: boolean) {
  const u = new URL(url);
  return {
    // Inside the container the server is on its own loopback.
    PGHOST: inContainer ? "localhost" : u.hostname,
    PGPORT: inContainer ? "5432" : u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: decodeURIComponent(u.pathname.replace(/^\//, "")),
  };
}

const majorOf = (versionText: string) =>
  Number(versionText.match(/(\d+)(\.\d+)?/)?.[1]);

async function serverMajor(url: string) {
  const sql = new SQL({ url, max: 1 });
  try {
    const [row] = await sql`show server_version_num`;
    return Math.floor(Number(row.server_version_num) / 10000);
  } finally {
    await sql.close();
  }
}

async function hostMajor(tool: Tool) {
  const result = await $`${tool} --version`.nothrow().quiet();
  return result.exitCode === 0 ? majorOf(result.stdout.toString()) : null;
}

/** How to run `tool` for `url`: on the host, or in `container`. */
async function runner(tool: Tool, url: string, container?: string) {
  const [server, host] = await Promise.all([serverMajor(url), hostMajor(tool)]);
  if (host === server) {
    return {
      cmd: [tool],
      env: { ...process.env, ...connectionEnv(url, false) },
    };
  }
  if (!container) {
    throw new Error(
      `the server is PostgreSQL ${server} but the host's ${tool} is ${host ?? "missing"}; pass --pg-container <name> to use the one inside the server's container`
    );
  }
  const env = connectionEnv(url, true);
  return {
    cmd: [
      "docker",
      "exec",
      "-i",
      ...Object.keys(env).flatMap((k) => ["-e", k]),
      container,
      tool,
    ],
    env: { ...process.env, ...env },
  };
}

async function run(
  tool: Tool,
  args: string[],
  url: string,
  container: string | undefined,
  io: { stdin?: string; stdout?: string }
) {
  const { cmd, env } = await runner(tool, url, container);
  const proc = Bun.spawn([...cmd, ...args], {
    env,
    stdin: io.stdin ? Bun.file(io.stdin) : "ignore",
    stdout: io.stdout ? Bun.file(io.stdout) : "inherit",
    stderr: "pipe",
  });
  const [code, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${tool} exited ${code}: ${stderr.trim()}`);
}

/** A custom-format dump of the database `url` names, written to `file`. */
export const dumpDatabase = (url: string, file: string, container?: string) =>
  run(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-privileges"],
    url,
    container,
    { stdout: file }
  );

/** Restores `file` into the (empty) database `url` names. */
export const restoreDatabase = (
  url: string,
  file: string,
  container?: string
) =>
  run(
    "pg_restore",
    [
      "--no-owner",
      "--no-privileges",
      "--exit-on-error",
      "--dbname",
      decodeURIComponent(new URL(url).pathname.slice(1)),
    ],
    url,
    container,
    {
      stdin: file,
    }
  );
