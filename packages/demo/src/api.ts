import {
  type ApiClient,
  createApiClient,
  defaultFetch,
} from "@workspace/api/lib/api-client";
import type { JobStatus } from "@workspace/api/lib/enums";

/** A signed-in caller: the typed API client carrying its bearer token. */
export interface Session {
  userId: string;
  token: string;
  api: ApiClient;
}

interface Result<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/** The response body of a call that must succeed; throws with the status and error body otherwise. */
export function must<T>(result: Result<T>, what: string): T {
  if (result.error !== undefined || !result.response.ok) {
    throw new Error(
      `${what}: HTTP ${result.response.status} ${JSON.stringify(result.error ?? null)}`
    );
  }
  return result.data as T;
}

/**
 * Sends each field as a form part and a `Blob` as a file part.
 * openapi-typescript types a binary part as `string`, so a caller hands the
 * `File` over in its place.
 */
export const formData = (body: unknown) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value === undefined) continue;
    form.append(key, value instanceof Blob ? value : String(value));
  }
  return form;
};

/**
 * The API a seed talks to. Better Auth is called over plain HTTP, the way the
 * apps do it, with the API's own origin (which Better Auth
 * always trusts); everything else goes through `@workspace/api`'s typed client
 * with the session's bearer token.
 */
export class DemoApi {
  readonly origin: string;

  constructor(readonly baseUrl: string) {
    this.origin = new URL(baseUrl).origin;
  }

  client(token?: string): ApiClient {
    return createApiClient({
      baseUrl: this.baseUrl,
      headers: token
        ? { Authorization: `Bearer ${token}`, Origin: this.origin }
        : { Origin: this.origin },
    });
  }

  private async auth(
    path: string,
    body: Record<string, unknown>,
    token?: string
  ): Promise<{ token: string | null; body: Record<string, unknown> }> {
    const response = await defaultFetch(`${this.baseUrl}/api/auth${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: this.origin,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response.ok || !json) {
      throw new Error(
        `POST /api/auth${path}: HTTP ${response.status} ${JSON.stringify(json)}`
      );
    }
    const inline = typeof json.token === "string" ? json.token : null;
    return {
      token: inline ?? response.headers.get("set-auth-token"),
      body: json,
    };
  }

  private session(token: string | null, body: Record<string, unknown>) {
    const user = body.user as { id?: unknown } | undefined;
    if (!token || typeof user?.id !== "string") {
      throw new Error(
        `Better Auth answered without a session: ${JSON.stringify(body)}`
      );
    }
    return { userId: user.id, token, api: this.client(token) };
  }

  async signUp(account: {
    name: string;
    email: string;
    password: string;
  }): Promise<Session> {
    const { token, body } = await this.auth("/sign-up/email", account);
    return this.session(token, body);
  }

  async signIn(account: { email: string; password: string }): Promise<Session> {
    const { token, body } = await this.auth("/sign-in/email", {
      email: account.email,
      password: account.password,
    });
    return this.session(token, body);
  }

  /** A share-page visitor: an anonymous session carrying the name they typed. */
  async guest(name: string): Promise<Session> {
    const { token, body } = await this.auth("/sign-in/anonymous", {});
    const session = this.session(token, body);
    await this.auth("/update-user", { name }, session.token);
    return session;
  }
}

const FINISHED: readonly JobStatus[] = ["done", "failed", "cancelled"];

/**
 * Waits for every job in `ids` to finish, printing progress, and throws if
 * any of them failed: a screenshot of a half-analysed catalogue is worse
 * than none.
 */
export async function waitForJobs(
  api: ApiClient,
  ids: number[],
  log: (line: string) => void
): Promise<void> {
  const pending = new Set(ids);
  const failed: string[] = [];
  let last = "";
  while (pending.size) {
    for (const id of [...pending]) {
      const job = must(
        await api.GET("/api/jobs/{id}", {
          params: { path: { id: String(id) } },
        }),
        `job ${id}`
      );
      if (!FINISHED.includes(job.status)) continue;
      pending.delete(id);
      if (job.status !== "done") {
        failed.push(
          `${job.label} ${job.subjectLabel ?? job.subjectId}: ${job.status} ${job.error ?? ""}`
        );
      }
    }
    const line = `  jobs: ${ids.length - pending.size}/${ids.length} finished`;
    if (line !== last) log((last = line));
    if (pending.size) await Bun.sleep(1000);
  }
  if (failed.length) throw new Error(`jobs failed:\n${failed.join("\n")}`);
}
