import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ProjammrClient,
  formatNetworkError,
  resolveToken,
  type FetchLike,
} from "./projammr-api.js";

describe("ProjammrClient", () => {
  it("resolves primary track audio target and fetches/creates comments", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];

    const mockFetch: FetchLike = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      });

      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        "Bearer tok-123"
      );

      if (url.endsWith("/api/sessions/10")) {
        return Response.json({
          id: 10,
          name: "Chorus Mix",
          trackId: 5,
          projectId: 1,
        });
      }
      if (url.endsWith("/api/tracks/5/audios")) {
        return Response.json([
          { id: 101, version: 1, label: "rough", isPrimary: false },
          { id: 102, version: 2, label: "mix 2", isPrimary: true },
        ]);
      }
      if (url.endsWith("/api/comments/track_audio/102")) {
        return Response.json([
          {
            id: 500,
            content: "snare a bit hot",
            positionMs: 8000,
            resolvedAt: null,
            user: { name: "Spence" },
          },
        ]);
      }
      if (url.endsWith("/api/comments") && method === "POST") {
        return Response.json(
          {
            id: 501,
            content: "new note",
            positionMs: 4000,
            resolvedAt: null,
            user: { name: "Spence" },
          },
          { status: 201 }
        );
      }
      return new Response("not found", { status: 404 });
    };

    const client = new ProjammrClient(
      "https://projammr.example/",
      "tok-123",
      mockFetch
    );
    const target = await client.resolveCommentTarget(10);
    assert.deepEqual(target, {
      targetType: "track_audio",
      targetId: 102,
      label: "Chorus Mix · Audio v2 (mix 2)",
    });

    const comments = await client.getComments(target.targetType, target.targetId);
    assert.equal(comments.length, 1);
    assert.equal(comments[0]?.positionMs, 8000);

    const created = await client.createComment({
      targetType: target.targetType,
      targetId: target.targetId,
      content: "new note",
      positionMs: 4000,
    });
    assert.equal(created.id, 501);
    assert.equal(calls.length, 4);
  });

  it("reads token from PROJAMMR_TOKEN env override", () => {
    assert.equal(
      resolveToken("https://projammr.example", {
        env: { PROJAMMR_TOKEN: " env-tok " },
      }),
      "env-tok"
    );
  });

  it("unwraps fetch cause codes into readable network errors", () => {
    const timeoutErr = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Connect Timeout Error"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      }),
    });
    assert.match(
      formatNetworkError("https://projammr.tailaee658.ts.net", timeoutErr),
      /projammr\.tailaee658\.ts\.net.*connection timed out/
    );
    const refusedErr = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    });
    assert.match(
      formatNetworkError("http://localhost:8080", refusedErr),
      /localhost:8080.*connection refused/
    );
  });
});
