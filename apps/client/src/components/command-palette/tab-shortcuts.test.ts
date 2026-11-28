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
  it("surfaces Home and Notes long-press destinations for viewers, plus Collections and Tracks for editors", () => {
    const viewerJumps = tabQuickJumps(DEFAULT_SHELL.dockTabs, projectCtx);
    expect(viewerJumps.map((j) => j.id)).toEqual(["home", "notes"]);
    expect(viewerJumps[1]).toMatchObject({
      id: "notes",
      label: "New note",
      href: NEW_NOTE_HREF,
      hint: "Hold Notes",
      commandId: "new-note",
    });

    const editorJumps = tabQuickJumps(DEFAULT_SHELL.dockTabs, {
      ...projectCtx,
      canEdit: true,
    });
    expect(editorJumps.map((j) => j.id)).toEqual([
      "home",
      "collections",
      "tracks",
      "notes",
    ]);
  });

  it("omits shortcuts for tabs absent from the configured dock policy", () => {
    expect(tabQuickJumps(["tracks", "studio", "search"], projectCtx)).toEqual(
      []
    );
  });

  it("deduplicates repeated tab ids", () => {
    const jumps = tabQuickJumps(["notes", "notes"], projectCtx);
    expect(jumps).toHaveLength(1);
  });
});
