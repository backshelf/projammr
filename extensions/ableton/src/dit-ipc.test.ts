import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import { describe, it } from "node:test";
import { DitIpcClient, type ConnectSocket } from "./dit-ipc.js";

function mockConnect(
  handler: (
    request: Record<string, unknown>,
    write: (frame: Record<string, unknown>) => void
  ) => void
): ConnectSocket {
  return () => {
    let incoming = "";
    const stream = new Duplex({
      read() {},
      write(chunk, _encoding, callback) {
        incoming += chunk.toString("utf8");
        const idx = incoming.indexOf("\n");
        if (idx !== -1) {
          const req = JSON.parse(incoming.slice(0, idx)) as Record<
            string,
            unknown
          >;
          incoming = incoming.slice(idx + 1);
          queueMicrotask(() => {
            handler(req, (frame) => {
              stream.push(`${JSON.stringify(frame)}\n`);
            });
          });
        }
        callback();
      },
    });
    return stream;
  };
}

describe("DitIpcClient", () => {
  it("handles ping, showPanel, and streaming run frames", async () => {
    const stderrLines: string[] = [];
    const seenRequests: Record<string, unknown>[] = [];
    const client = new DitIpcClient(
      "/mock/dit.sock",
      mockConnect((req, write) => {
        seenRequests.push(req);
        const id = req.id as number;
        if (req.op === "ping" || req.op === "show-panel") {
          write({ id, ok: true });
          return;
        }
        write({ id, stream: "stderr", text: "pushing…\n" });
        write({
          id,
          done: {
            stdout: JSON.stringify({ id: "deadbeef", message: "chorus" }),
            code: 0,
            refusal: null,
          },
        });
      })
    );

    assert.equal(await client.ping(), true);
    await client.showPanel();
    const committed = await client.commit("/tmp/Project", {
      message: "chorus",
      onStderr: (line) => stderrLines.push(line),
    });

    assert.equal(committed.id, "deadbeef");
    assert.equal(committed.message, "chorus");
    assert.deepEqual(stderrLines, ["pushing…\n"]);
    assert.deepEqual(seenRequests[2]?.argv, [
      "commit",
      "--json",
      "-m",
      "chorus",
    ]);
  });

  it("reports not running when socket is missing", async () => {
    const client = new DitIpcClient("/mock/missing.sock", () => {
      const stream = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });
      queueMicrotask(() => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        stream.destroy(err);
      });
      return stream;
    });
    assert.equal(await client.ping(), false);
    await assert.rejects(() => client.showPanel(), /isn't running/);
  });
});
