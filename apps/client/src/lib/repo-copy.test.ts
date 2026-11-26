import { describe, expect, it } from "bun:test";
import {
  lastPushLine,
  lastPushWhen,
  ownMachineHref,
  storageLine,
} from "./repo-copy";

const format = { relative: () => "2h ago" };

const machine = (userId = "u1") => ({
  id: "machine-0001-abcdef",
  name: "studio-mac",
  userId,
  removed: false,
});

describe("lastPushLine", () => {
  it("names the time and the machine as plain text", () => {
    expect(
      lastPushLine(
        {
          lastPushAt: "2026-06-01T10:00:00.000Z",
          lastPushMachine: machine(),
        },
        format
      )
    ).toBe("Last push 2h ago from studio-mac");
  });

  it("drops the machine when the push named none", () => {
    expect(
      lastPushLine(
        { lastPushAt: "2026-06-01T10:00:00.000Z", lastPushMachine: null },
        format
      )
    ).toBe("Last push 2h ago");
  });

  it("says nothing was pushed when there is no push", () => {
    expect(
      lastPushLine({ lastPushAt: null, lastPushMachine: null }, format)
    ).toBe("Nothing pushed yet.");
  });
});

describe("lastPushWhen", () => {
  it("is the line without its machine", () => {
    expect(
      lastPushWhen({ lastPushAt: "2026-06-01T10:00:00.000Z" }, format)
    ).toBe("Last push 2h ago");
    expect(lastPushWhen({ lastPushAt: null }, format)).toBe(
      "Nothing pushed yet."
    );
  });
});

describe("ownMachineHref", () => {
  it("opens the machine's row in Settings when the machine is the viewer's", () => {
    expect(ownMachineHref(machine("u1"), "u1")).toBe(
      "/settings/devices#machine-machine-0001-abcdef"
    );
  });

  it("gives another user's machine no link", () => {
    expect(ownMachineHref(machine("u2"), "u1")).toBeNull();
  });

  it("gives a removed machine no link, its row being gone", () => {
    expect(
      ownMachineHref({ ...machine("u1"), removed: true }, "u1")
    ).toBeNull();
  });

  it("gives no link to a viewer who is not signed in", () => {
    expect(ownMachineHref(machine("u1"), null)).toBeNull();
  });
});

describe("storageLine", () => {
  const format = { bytes: (n: number) => `${n}B` };

  it("reads sets and samples, and what sharing saved when it saved something", () => {
    expect(
      storageLine({ setBytes: 10, sampleBytes: 20, sharedBytes: 30 }, format)
    ).toBe("Sets 10B · Samples 20B · 30B saved by sharing");
  });

  it("leaves the sharing clause out when nothing was saved", () => {
    expect(
      storageLine({ setBytes: 10, sampleBytes: 0, sharedBytes: 0 }, format)
    ).toBe("Sets 10B · Samples 0B");
  });
});
