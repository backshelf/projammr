import { describe, expect, it } from "bun:test";
import { DEFAULT_SHELL } from "@/lib/policies/shell";
import { NEW_NOTE_HREF } from "@/lib/utils";
import type { TabContext } from "@/components/dock/tabs";
import { tabQuickJumps } from "./tab-shortcuts";

const projectCtx: TabContext = {
  projectId: 7,
  route: { kind: "track-all" },
  pathname: "/project/7/track/all",
};

describe("tabQuickJumps", () => {
  it("surfaces the Notes tab's long-press destination with its gesture hint", () => {
    const jumps = tabQuickJumps(DEFAULT_SHELL.dockTabs, projectCtx);

    expect(jumps).toHaveLength(1);
    expect(jumps[0]).toMatchObject({
      id: "notes",
      label: "New note",
      href: NEW_NOTE_HREF,
      hint: "Hold Notes",
      commandId: "new-note",
    });
  });

  it("omits shortcuts for tabs absent from the configured dock policy", () => {
    expect(tabQuickJumps(["tracks", "sessions", "search"], projectCtx)).toEqual(
      []
    );
  });

  it("deduplicates repeated tab ids", () => {
    const jumps = tabQuickJumps(["notes", "notes"], projectCtx);
    expect(jumps).toHaveLength(1);
  });
});
