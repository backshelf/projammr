import { describe, expect, it } from "bun:test";
import type { AudioAudit } from "../../db/queries/track-audios.js";
import { setupSuite } from "../../test/fixtures.js";
import { authInfoFor, type Actor } from "../actor.js";
import { createMcpHandlerFor } from "../registry.js";
import { AUDIO_RESOURCES, auditMarkdown } from "./audio.js";

const suite = setupSuite("MCP audio resource");
const { owner, outsider } = suite;

function actorFor(userId: string): Actor {
  return {
    id: userId,
    name: "",
    scopes: new Set(["read"]),
    user: {} as Actor["user"],
  };
}

type JsonRpcResponse = {
  result?: { contents?: { text: string }[] };
  error?: unknown;
};

const handler = createMcpHandlerFor([], AUDIO_RESOURCES);

async function readResource(
  actor: Actor,
  uri: string
): Promise<{ status: number; body: JsonRpcResponse }> {
  const request = new Request("http://localhost/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "resources/read",
      "mcp-name": uri,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/read",
      params: {
        uri,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
  const res = await handler.fetch(request, {
    authInfo: authInfoFor(actor, { sub: actor.id }, "test-token"),
  });
  return { status: res.status, body: (await res.json()) as JsonRpcResponse };
}

const fixtureAudit: AudioAudit = {
  tracks: [
    {
      trackId: 1,
      title: "Long Way Home",
      versions: [
        {
          id: 10,
          version: 1,
          isPrimary: true,
          primaryPinned: false,
          asset: {
            id: 100,
            name: "long-way-home-v1.wav",
            type: "audio/wav",
            size: 1024,
            fingerprint: "fp-1",
            localFilepath: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
          },
          sessions: [{ id: 1000, name: "Tracking", linkedToThisTrack: true }],
          fileExists: true,
          analysis: {
            current: true,
            durationMs: 182_000,
            lufs: -14.2,
            lra: 6.1,
            truePeakDb: -1.4,
            silence: { leadMs: 500, tailMs: 1200 },
            clippedBins: 3,
            clippedFrames: 40,
            clippedOverBins: 1,
            bpm: 120.5,
            bpmConfidence: 0.9,
            musicalKey: "F♯ minor",
            keyConfidence: 0.8,
            duplicateOfId: null,
          },
        },
      ],
      unlinkedCandidates: [],
    },
    {
      trackId: 2,
      title: "No Takes Yet",
      versions: [],
      unlinkedCandidates: [],
    },
  ],
  duplicateFingerprints: [],
  findings: [
    {
      code: "no_audio",
      severity: "info",
      trackId: 2,
      message: '"No Takes Yet" has no audio version.',
    },
    {
      code: "missing_file",
      severity: "error",
      trackId: 1,
      trackAudioId: 10,
      message: "the stored file is gone.",
      fix: "unlink_audio_version",
    },
  ],
};

describe("auditMarkdown", () => {
  it("groups findings by severity and tables each track's versions", () => {
    const markdown = auditMarkdown(fixtureAudit);
    expect(markdown).toMatchSnapshot();
  });

  it("says so when there are no findings", () => {
    const markdown = auditMarkdown({ ...fixtureAudit, findings: [] });
    expect(markdown).toContain("No findings.");
  });
});

describe("projammr://projects/{projectId}/audio-audit", () => {
  it("answers an error for a caller outside the project", async () => {
    suite.requireProject();
    const uri = `projammr://projects/${suite.projectId}/audio-audit`;
    const { body } = await readResource(actorFor(outsider.userId), uri);
    expect(body.result).toBeUndefined();
    expect(body.error).toBeDefined();
  });

  it("answers markdown for a project member", async () => {
    suite.requireProject();
    const uri = `projammr://projects/${suite.projectId}/audio-audit`;
    const { status, body } = await readResource(actorFor(owner.userId), uri);
    expect(status).toBe(200);
    expect(body.result?.contents?.[0]?.text).toContain("# Audio audit");
  });
});
