import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { captureLogs } from "../test/log.js";
import { requestLog } from "./request-log.js";

const app = new Hono();
app.use("*", requestLog);
app.get("*", (c) => c.text("ok"));

/** The log lines written while `paths` were requested, for each path. */
async function logLinesFor(...paths: string[]): Promise<string[][]> {
  const written = await captureLogs(async () => {
    for (const path of paths) await app.request(path);
  });
  return paths.map((path) =>
    written.filter((line) => line.includes(`"${path.split("?")[0]}"`))
  );
}

const atInfo = (line: string) => /\binfo\b/.test(line);

describe("requestLog", () => {
  it("logs an ordinary request at info", async () => {
    const [lines] = await logLinesFor("/api/projects/7/labels");
    expect(lines!.some(atInfo)).toBe(true);
  });

  it("keeps a project's jobs read and job event stream below info", async () => {
    const logged = await logLinesFor(
      "/api/projects/7/jobs?status=queued,running&recentMs=10000",
      "/api/projects/7/jobs/events"
    );
    for (const lines of logged) expect(lines.some(atInfo)).toBe(false);
  });
});
