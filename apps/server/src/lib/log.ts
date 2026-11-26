import type { LogLevel as Level } from "@workspace/settings/groups/instance-integrations";
import { instancePolicy } from "./instance-policy.js";

type Fields = Record<string, unknown>;

const order: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const asJson = process.env.LOG_FORMAT === "json";

/** The instance's `integrations.logLevel`, read per line so a change applies to the next one. */
const policyLevel = (): Level => instancePolicy().integrations.logLevel;

/** Where a formatted line goes: stdout, or stderr for an error. */
type Sink = {
  write: (level: Level, line: string) => void;
  minLevel: () => Level;
};

const stdio: Sink = {
  write: (level, line) => {
    (level === "error" ? process.stderr : process.stdout).write(line);
  },
  minLevel: policyLevel,
};

let sink: Sink = stdio;

/**
 * Sends every log line at `minLevel` and above to `capture` instead of stdout
 * and stderr, until the returned function restores them. A test reads log
 * lines through this rather than by spying on `process.stdout`, which a
 * parallel test worker routes itself.
 */
export function redirectLogs(
  capture: (line: string) => void,
  minLevel: Level = "debug"
): () => void {
  sink = { write: (_level, line) => capture(line), minLevel: () => minLevel };
  return () => {
    sink = stdio;
  };
}

function emit(level: Level, scope: string, msg: string, fields?: Fields) {
  if (order[level] < order[sink.minLevel()]) return;

  const at = new Date().toISOString();

  if (asJson) {
    sink.write(
      level,
      JSON.stringify({ at, level, scope, msg, ...fields }) + "\n"
    );
    return;
  }

  const extra = fields
    ? " " +
      Object.entries(fields)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(" ")
    : "";

  const line = `${at} ${level.padEnd(5)} [${scope}] ${msg}${extra}\n`;
  sink.write(level, line);
}

export type Logger = Record<Level, (msg: string, fields?: Fields) => void>;

/** A logger bound to one scope — a route file, a query module, the queue. */
export function log(scope: string): Logger {
  return {
    debug: (msg, fields) => emit("debug", scope, msg, fields),
    info: (msg, fields) => emit("info", scope, msg, fields),
    warn: (msg, fields) => emit("warn", scope, msg, fields),
    error: (msg, fields) => emit("error", scope, msg, fields),
  };
}

/**
 * An error as log fields. An `Error` does not survive `JSON.stringify`, so the
 * parts worth keeping are pulled out by hand.
 */
export function errorFields(err: unknown): Fields {
  if (err instanceof Error) return { error: err.message, stack: err.stack };
  return { error: String(err) };
}
