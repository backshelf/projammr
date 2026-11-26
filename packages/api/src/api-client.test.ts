import { describe, expect, it } from "bun:test";
import { createFetchWithRetry } from "./api-client";

const ok = () => new Response("ok", { status: 200 });
const gatewayTimeout = () => new Response("gateway timeout", { status: 504 });

describe("createFetchWithRetry", () => {
  it("retries idempotent methods on 502/503/504/408 and transient network errors", async () => {
    for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]) {
      let calls = 0;
      const fetcher = createFetchWithRetry({
        maxRetries: 2,
        initialDelayMs: 1,
        fetch: async () => {
          calls += 1;
          return calls === 1 ? gatewayTimeout() : ok();
        },
      });

      const res = await fetcher("http://example.test/resource", { method });
      expect(res.status).toBe(200);
      expect(calls).toBe(2);
    }
  });

  it("never auto-retries POST or PATCH on 504 or transient network errors", async () => {
    for (const method of ["POST", "PATCH"]) {
      let statusCalls = 0;
      const statusFetcher = createFetchWithRetry({
        maxRetries: 3,
        initialDelayMs: 1,
        fetch: async () => {
          statusCalls += 1;
          return gatewayTimeout();
        },
      });

      const res = await statusFetcher("http://example.test/items", {
        method,
        body: JSON.stringify({ name: "Test" }),
      });
      expect(res.status).toBe(504);
      expect(statusCalls).toBe(1);

      let netCalls = 0;
      const netFetcher = createFetchWithRetry({
        maxRetries: 3,
        initialDelayMs: 1,
        fetch: async () => {
          netCalls += 1;
          throw new TypeError("fetch failed");
        },
      });

      await expect(
        netFetcher(
          new Request("http://example.test/items", {
            method,
            body: JSON.stringify({ name: "Test" }),
          })
        )
      ).rejects.toThrow("fetch failed");
      expect(netCalls).toBe(1);
    }
  });

  it("aborts immediately during retry backoff sleep when signal aborts", async () => {
    const controller = new AbortController();
    let calls = 0;
    let sleeping!: () => void;
    const retryStarted = new Promise<void>((resolve) => {
      sleeping = resolve;
    });

    const fetcher = createFetchWithRetry({
      maxRetries: 3,
      initialDelayMs: 60_000,
      maxDelayMs: 60_000,
      onRetry: () => sleeping(),
      fetch: async () => {
        calls += 1;
        return gatewayTimeout();
      },
    });

    const pending = fetcher("http://example.test/slow", {
      method: "GET",
      signal: controller.signal,
    });

    await retryStarted;
    controller.abort(new DOMException("cancelled", "AbortError"));

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});
