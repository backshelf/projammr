/**
 * Minimal HTTP client for Projammr's REST API, authenticating with the existing `dit`
 * session token (via `PROJAMMR_TOKEN`, extension storage, or macOS Keychain).
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface SessionInfo {
  id: number;
  name: string;
  trackId: number | null;
  projectId: number;
}

export interface TrackAudioVersion {
  id: number;
  version: number;
  label: string | null;
  isPrimary?: boolean;
}

export interface ProjammrComment {
  id: number;
  content: string;
  positionMs: number | null;
  resolvedAt: string | null;
  user: {
    name?: string | null;
    email?: string | null;
  } | null;
}

export interface CommentTarget {
  targetType: "track_audio" | "session";
  targetId: number;
  label: string;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

const KEYCHAIN_SERVICES = ["dit", "dit.dev"] as const;
const REQUEST_TIMEOUT_MS = 10_000;

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function formatNetworkError(baseUrl: string, err: unknown): string {
  const host = hostOf(baseUrl);
  const error = err instanceof Error ? err : new Error(String(err));
  const cause = (error as { cause?: unknown }).cause;
  const causeObj =
    cause && typeof cause === "object"
      ? (cause as { code?: string; message?: string })
      : null;
  const code = causeObj?.code ?? (error as { code?: string }).code;

  if (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ETIMEDOUT"
  ) {
    return `Can\u2019t reach ${host} (connection timed out). Check that the server or Tailscale is up.`;
  }
  if (code === "ECONNREFUSED") {
    return `Can\u2019t reach ${host} (connection refused).`;
  }
  if (code === "ENOTFOUND") {
    return `Can\u2019t resolve ${host} (DNS lookup failed).`;
  }
  if (code && /CERT|TLS|SSL/i.test(code)) {
    return `TLS error connecting to ${host} (${code}).`;
  }
  const detail = causeObj?.message || error.message;
  return `Can\u2019t reach ${host}: ${detail}`;
}

export function resolveToken(
  instanceUrl: string,
  options?: { storageDirectory?: string | undefined; env?: NodeJS.ProcessEnv }
): string | null {
  const env = options?.env ?? process.env;
  if (env.PROJAMMR_TOKEN?.trim()) {
    return env.PROJAMMR_TOKEN.trim();
  }

  if (options?.storageDirectory) {
    try {
      const stored = JSON.parse(
        fs.readFileSync(
          path.join(options.storageDirectory, "auth.json"),
          "utf8"
        )
      ) as Record<string, string>;
      const match = stored[instanceUrl] ?? stored.token;
      if (match?.trim()) return match.trim();
    } catch {
      // No stored token file
    }
  }

  if (process.platform === "darwin") {
    for (const service of KEYCHAIN_SERVICES) {
      try {
        const token = execFileSync(
          "/usr/bin/security",
          ["find-generic-password", "-s", service, "-a", instanceUrl, "-w"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        ).trim();
        if (token) return token;
      } catch {
        // Not stored under this service
      }
    }
  }

  return null;
}

export class ProjammrClient {
  private readonly baseUrl: string;

  constructor(
    instanceUrl: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.baseUrl = instanceUrl.replace(/\/+$/, "");
  }

  private async request<T>(apiPath: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/api${apiPath}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        ...init,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          ...(init?.body ? { "Content-Type": "application/json" } : {}),
          ...init?.headers,
        },
      });
    } catch (err) {
      throw new Error(formatNetworkError(this.baseUrl, err));
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          `Signed out of ${hostOf(this.baseUrl)}. Run \`dit login\` to sign in again.`
        );
      }
      let detail = `${response.status} ${response.statusText}`;
      try {
        const body = (await response.json()) as {
          message?: string;
          error?: string;
        };
        if (body.message || body.error) {
          detail = body.message ?? body.error ?? detail;
        }
      } catch {
        // Plain-text error body
      }
      throw new Error(`${hostOf(this.baseUrl)} refused the request: ${detail}`);
    }
    return (await response.json()) as T;
  }

  getSession(sessionId: number): Promise<SessionInfo> {
    return this.request<SessionInfo>(`/sessions/${sessionId}`);
  }

  getTrackAudios(trackId: number): Promise<TrackAudioVersion[]> {
    return this.request<TrackAudioVersion[]>(`/tracks/${trackId}/audios`);
  }

  /**
   * Resolves the best comment target for a bound session: prefers the primary/latest
   * `track_audio` version (where timestamped waveform comments live), falling back to `session`.
   */
  async resolveCommentTarget(sessionId: number): Promise<CommentTarget> {
    const session = await this.getSession(sessionId);
    if (session.trackId !== null) {
      const audios = await this.getTrackAudios(session.trackId);
      const preferred =
        audios.find((a) => a.isPrimary) ??
        [...audios].sort((a, b) => b.version - a.version)[0];
      if (preferred) {
        const suffix = preferred.label
          ? `v${preferred.version} (${preferred.label})`
          : `v${preferred.version}`;
        return {
          targetType: "track_audio",
          targetId: preferred.id,
          label: `${session.name} · Audio ${suffix}`,
        };
      }
    }
    return {
      targetType: "session",
      targetId: session.id,
      label: `${session.name} · Session`,
    };
  }

  getComments(
    targetType: CommentTarget["targetType"],
    targetId: number
  ): Promise<ProjammrComment[]> {
    return this.request<ProjammrComment[]>(
      `/comments/${targetType}/${targetId}`
    );
  }

  createComment(input: {
    targetType: CommentTarget["targetType"];
    targetId: number;
    content: string;
    positionMs?: number | null;
  }): Promise<ProjammrComment> {
    return this.request<ProjammrComment>("/comments", {
      method: "POST",
      body: JSON.stringify({
        targetType: input.targetType,
        targetId: input.targetId,
        content: input.content,
        ...(typeof input.positionMs === "number"
          ? { positionMs: input.positionMs }
          : {}),
      }),
    });
  }
}
