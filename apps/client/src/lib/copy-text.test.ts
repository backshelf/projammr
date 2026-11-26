import { afterEach, describe, expect, it, mock } from "bun:test";
import { stubGlobal, unstubAllGlobals } from "@workspace/test/globals";

import { copyText } from "./copy-text";

class FakeTextarea {
  value = "";
  readOnly = false;
  style: Record<string, string> = {};
  focus() {}
  select() {}
  setSelectionRange() {}
}

function stubDocument(execCommand: () => boolean) {
  stubGlobal("document", {
    createElement: () => new FakeTextarea(),
    body: {
      appendChild: () => {},
      removeChild: () => {},
    },
    execCommand,
  });
}

describe("copyText", () => {
  afterEach(() => unstubAllGlobals());

  it("uses the Clipboard API when it succeeds", async () => {
    const writeText = mock(() => Promise.resolve());
    stubGlobal("navigator", { clipboard: { writeText } });

    const ok = await copyText("https://example.com/track/1");

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://example.com/track/1");
  });

  it("falls back to execCommand when navigator.clipboard is undefined", async () => {
    stubGlobal("navigator", {});
    stubDocument(() => true);

    const ok = await copyText("https://example.com/track/1");

    expect(ok).toBe(true);
  });

  it("falls back to execCommand when writeText rejects", async () => {
    stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("denied")) },
    });
    const execCommand = mock(() => true);
    stubDocument(execCommand);

    const ok = await copyText("https://example.com/track/1");

    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when execCommand returns false", async () => {
    stubGlobal("navigator", {});
    stubDocument(() => false);

    const ok = await copyText("https://example.com/track/1");

    expect(ok).toBe(false);
  });

  it("reports failure when execCommand throws", async () => {
    stubGlobal("navigator", {});
    stubDocument(() => {
      throw new Error("not supported");
    });

    const ok = await copyText("https://example.com/track/1");

    expect(ok).toBe(false);
  });
});
