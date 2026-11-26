import { redirectLogs } from "../lib/log.js";

/** Every log line written, at any level, while `run` was pending. */
export async function captureLogs(
  run: () => Promise<unknown>
): Promise<string[]> {
  const lines: string[] = [];
  const restore = redirectLogs((line) => lines.push(line));
  try {
    await run();
  } finally {
    restore();
  }
  return lines;
}
