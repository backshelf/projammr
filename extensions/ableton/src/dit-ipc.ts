/**
 * Client for `dit`'s local Unix domain socket (`~/Library/Application Support/dit/dit.sock`),
 * speaking protocol v1 as defined in `packages/dit/crates/dit-ipc/src/protocol.rs`.
 */
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { Duplex } from "node:stream";

const PROTOCOL_VERSION = 1;
const DEFAULT_TIMEOUT_MS = 15_000;

export type ConnectSocket = (socketPath: string) => Duplex;

export interface DitDone {
  stdout: string;
  code: number;
  refusal: string | null;
}

export interface DitStatusRow {
  setId: string;
  file: string;
  branch: string;
  savesSinceCommit: number;
  workingChanged: boolean;
  pendingSaves: number;
  pendingCommits: number;
  pendingSamples: number;
}

export interface DitStatusResult {
  sets: DitStatusRow[];
}

export interface DitCommitResult {
  id: string;
  message: string;
  pushError?: string;
}

type Frame =
  | { id: number; stream: "stderr"; text: string }
  | { id: number; done: DitDone }
  | { id: number; ok: boolean }
  | { id: number; error: string };

export function defaultSocketPath(
  home = os.homedir(),
  platform = process.platform,
  env = process.env
): string {
  if (env.DIT_SOCK) {
    return env.DIT_SOCK;
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "dit", "dit.sock");
  }
  const configBase = env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(configBase, "dit", "dit.sock");
}

function sendRequest(
  socketPath: string,
  connect: ConnectSocket,
  payload: Record<string, unknown>,
  options?: { timeoutMs?: number; onStderr?: (text: string) => void }
): Promise<Frame> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    let buffer = "";
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      fn();
    };

    if ("setTimeout" in socket && typeof socket.setTimeout === "function") {
      socket.setTimeout(timeoutMs);
    }

    socket.on("timeout", () => {
      finish(() =>
        reject(new Error("Timed out waiting for the dit app to respond."))
      );
    });

    socket.on("error", (error: NodeJS.ErrnoException) => {
      const detail =
        error.code === "ENOENT" || error.code === "ECONNREFUSED"
          ? "The dit menu bar app isn't running."
          : `Could not reach dit (${error.message}).`;
      finish(() => reject(new Error(detail)));
    });

    socket.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let frame: Frame;
        try {
          frame = JSON.parse(line) as Frame;
        } catch {
          continue;
        }
        if ("stream" in frame && frame.stream === "stderr") {
          options?.onStderr?.(frame.text);
          continue;
        }
        finish(() => resolve(frame));
        return;
      }
    });

    socket.on("end", () => {
      finish(() => reject(new Error("dit closed the socket unexpectedly.")));
    });

    socket.write(`${JSON.stringify(payload)}\n`);
  });
}

let nextRequestId = 1;

export class DitIpcClient {
  constructor(
    private readonly socketPath = defaultSocketPath(),
    private readonly connect: ConnectSocket = (p) => net.createConnection(p)
  ) {}

  async ping(): Promise<boolean> {
    try {
      const frame = await sendRequest(
        this.socketPath,
        this.connect,
        { v: PROTOCOL_VERSION, id: nextRequestId++, op: "ping" },
        { timeoutMs: 3_000 }
      );
      return "ok" in frame && frame.ok === true;
    } catch {
      return false;
    }
  }

  async showPanel(): Promise<void> {
    const frame = await sendRequest(
      this.socketPath,
      this.connect,
      { v: PROTOCOL_VERSION, id: nextRequestId++, op: "show-panel" },
      { timeoutMs: 3_000 }
    );
    if ("error" in frame) {
      throw new Error(frame.error);
    }
  }

  async run(
    cwd: string,
    argv: string[],
    options?: { timeoutMs?: number; onStderr?: (text: string) => void }
  ): Promise<DitDone> {
    const env: Record<string, string> = {};
    for (const key of ["DIT_AUTHOR", "USER", "DIT_MACHINE"] as const) {
      const value = process.env[key];
      if (value) env[key] = value;
    }
    const frame = await sendRequest(
      this.socketPath,
      this.connect,
      { v: PROTOCOL_VERSION, id: nextRequestId++, cwd, env, argv },
      options
    );
    if ("error" in frame) {
      throw new Error(frame.error);
    }
    if (!("done" in frame)) {
      throw new Error("Unexpected response from dit.");
    }
    return frame.done;
  }

  async status(cwd: string, setFile?: string): Promise<DitStatusResult> {
    const argv = ["status", "--json"];
    if (setFile) argv.push(setFile);
    const done = await this.run(cwd, argv);
    if (done.code !== 0) {
      throw new Error(done.refusal || "dit status failed.");
    }
    return JSON.parse(done.stdout) as DitStatusResult;
  }

  async suggestedCommit(
    cwd: string,
    setFile?: string
  ): Promise<{ message: string | null; firstCommit: boolean }> {
    const argv = ["diff"];
    if (setFile) argv.push("--set", setFile);
    const done = await this.run(cwd, argv);
    if (done.code !== 0) {
      return {
        message: null,
        firstCommit: Boolean(done.refusal?.includes("has no commits yet")),
      };
    }
    const firstLine = done.stdout.trim().split("\n")[0]?.trim();
    return {
      message: firstLine && firstLine !== "no changes" ? firstLine : null,
      firstCommit: false,
    };
  }

  async commit(
    cwd: string,
    options: {
      message?: string;
      noPush?: boolean;
      setFile?: string;
      onStderr?: (text: string) => void;
    }
  ): Promise<DitCommitResult> {
    const argv = ["commit", "--json"];
    if (options.message?.trim()) {
      argv.push("-m", options.message.trim());
    }
    if (options.noPush) {
      argv.push("--no-push");
    }
    if (options.setFile) {
      argv.push(options.setFile);
    }
    const done = await this.run(cwd, argv, {
      timeoutMs: 60_000,
      ...(options.onStderr ? { onStderr: options.onStderr } : {}),
    });
    if (done.code !== 0) {
      throw new Error(done.refusal || "dit commit failed.");
    }
    return JSON.parse(done.stdout) as DitCommitResult;
  }
}
