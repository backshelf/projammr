import type { Machine, MachinePresence } from "@workspace/api/api";
import { describe, expect, it } from "bun:test";
import {
  holderOfRepo,
  holderOfSession,
  OPEN_IN_DAW_UNAVAILABLE,
  openInDawHref,
  openInDawTarget,
  restoreHref,
} from "./open-in-daw";

const presence = (over: Partial<MachinePresence>): MachinePresence =>
  ({
    id: "m1",
    name: "studio",
    tracksRepo: false,
    openingThis: false,
    ...over,
  }) as MachinePresence;

const machine = (over: Partial<Machine>): Machine =>
  ({
    id: "m1",
    name: "studio",
    online: true,
    repoIds: [],
    pushedRepos: [],
    ...over,
  }) as Machine;

const pushed = (...ids: number[]): Machine["pushedRepos"] =>
  ids.map((id) => ({ id, name: `repo ${id}`, projectId: 1 }));

describe("holderOfSession", () => {
  it("names the first machine that tracks the repo", () => {
    expect(
      holderOfSession([
        presence({ name: "laptop" }),
        presence({ name: "studio", tracksRepo: true }),
      ])
    ).toEqual({ name: "studio" });
  });

  it("names nobody when no machine tracks the repo", () => {
    expect(holderOfSession([presence({ name: "laptop" })])).toBeNull();
    expect(holderOfSession([])).toBeNull();
  });
});

describe("holderOfRepo", () => {
  it("names an online machine that tracks the row's repo", () => {
    expect(
      holderOfRepo(
        [
          machine({ name: "offline", online: false, repoIds: [3] }),
          machine({ name: "studio", repoIds: [2, 3] }),
        ],
        3
      )
    ).toEqual({ name: "studio" });
  });

  it("names a machine that tracks a repo it never pushed", () => {
    expect(
      holderOfRepo(
        [machine({ name: "studio", repoIds: [3], pushedRepos: [] })],
        3
      )
    ).toEqual({ name: "studio" });
  });

  it("does not take a pushed repo for a tracked one", () => {
    expect(
      holderOfRepo([machine({ repoIds: [], pushedRepos: pushed(3) })], 3)
    ).toBeNull();
  });

  it("names nobody for a row without a repo, or a repo no online machine tracks", () => {
    expect(holderOfRepo([machine({ repoIds: [3] })], null)).toBeNull();
    expect(holderOfRepo([machine({ repoIds: [3] })], 9)).toBeNull();
    expect(
      holderOfRepo([machine({ online: false, repoIds: [3] })], 3)
    ).toBeNull();
  });
});

describe("openInDawTarget", () => {
  it("opens the session on its holder, saying which machine", () => {
    expect(openInDawTarget(9, { name: "studio" })).toEqual({
      href: "projammr://session/9",
      tooltip: "Opens the file on studio",
    });
  });

  it("is disabled, saying why, without a holder", () => {
    expect(openInDawTarget(9, null)).toEqual({
      href: null,
      tooltip: OPEN_IN_DAW_UNAVAILABLE,
    });
    expect(OPEN_IN_DAW_UNAVAILABLE).toBe(
      "Needs dit on the computer that has this set."
    );
  });

  it("builds the session and restore addresses", () => {
    expect(openInDawHref(9)).toBe("projammr://session/9");
    expect(restoreHref(14)).toBe("projammr://dit/checkout/14");
  });
});
