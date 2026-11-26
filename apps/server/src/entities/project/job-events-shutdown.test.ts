import { describe, expect, it } from "bun:test";
import { waitFor } from "@workspace/test/wait-for";
import { beginShutdown } from "../../lib/connections.js";
import { projectListenerCount } from "../../lib/job-events.js";
import { setupSuite } from "../../test/fixtures.js";
import { sseReader } from "../../test/sse.js";

// Beginning a shutdown cannot be undone, so it has a file of its own: every
// file runs in a fresh module registry, and no other stream sees it.
const suite = setupSuite("Job events shutdown");
const { requireProject, request } = suite;

describe("job event stream at shutdown", () => {
  it("ends open event streams, and any opened after, once shutdown begins", async () => {
    requireProject();
    const path = `/projects/${suite.projectId}/jobs/events`;

    const open = sseReader((await request("viewer", path)).body!);
    expect((await open.next()).event).toBe("snapshot");

    beginShutdown();

    await expect(open.next()).rejects.toThrow("the stream ended");
    await waitFor(() => expect(projectListenerCount(suite.projectId)).toBe(0));

    const late = sseReader((await request("viewer", path)).body!);
    await expect(late.next()).rejects.toThrow("the stream ended");
    await waitFor(() => expect(projectListenerCount(suite.projectId)).toBe(0));
  });
});
