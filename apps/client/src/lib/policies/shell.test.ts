import { describe, expect, it } from "bun:test";
import {
  confirmPolicy,
  DEFAULT_FEEDBACK,
  DEFAULT_SHELL,
  DELETE_KINDS,
  type FeedbackPolicy,
  shownSections,
} from "./shell";

const shown = <const Id extends string>(
  ids: readonly Id[],
  hidden: readonly Id[] = []
) => ids.map((id) => ({ id, shown: !hidden.includes(id) }));

describe("DEFAULT_SHELL", () => {
  it("is the shell as it has always been laid out", () => {
    expect(DEFAULT_SHELL).toEqual({
      sidebarWidthRem: 16,
      recentItems: 5,
      recentsSkipArchived: true,
      sidebarSections: [
        { id: "collections", shown: true, collapsed: false },
        { id: "tracks", shown: true, collapsed: false },
        { id: "studio", shown: true, collapsed: true },
        { id: "notebook", shown: true, collapsed: false },
      ],
      sidebarCollectionOrder: "release",
      dockTabs: ["home", "collections", "tracks", "notes", "search"],
      paletteResultCap: 5,
      paletteAliases: {},
      paletteEmptyGroups: ["actions", "recent-tracks", "recent-sessions"],
      projectHomeSections: shown(
        [
          "new",
          "unassigned-sets",
          "quiet",
          "jobs",
          "overview",
          "collections",
          "plugins",
          "samples",
          "heatmap",
          "links",
          "attachments",
          "comments",
          "add",
          "activity",
        ],
        ["plugins", "samples", "heatmap"]
      ),
      entityPageSections: {
        collection: shown([
          "overview",
          "tracks",
          "attachments",
          "comments",
          "add",
          "activity",
        ]),
        track: shown([
          "overview",
          "lyrics",
          "relations",
          "attachments",
          "comments",
          "add",
          "activity",
        ]),
        session: shown([
          "notes",
          "structure",
          "attachments",
          "samples",
          "history",
          "comments",
          "add",
        ]),
      },
      inventoryDefaults: {
        plugins: { origin: "all", stock: false },
        samples: { show: "all", library: false, stock: false },
      },
      afterCreate: "open",
      audioCommentPinned: true,
      commandBar: { enabled: false, position: "bottom", mode: "always" },
    });
  });
});

describe("DEFAULT_FEEDBACK", () => {
  it("is sonner's own toast and every delete asking first", () => {
    expect(DEFAULT_FEEDBACK).toEqual({
      haptics: true,
      toastDurationMs: 4000,
      toastPosition: "bottom-right",
      confirmDeletes: {
        project: true,
        collection: true,
        track: true,
        session: true,
        note: true,
        status: true,
        label: true,
        file: true,
        attachment: true,
        audioVersion: true,
        comment: true,
        savedView: true,
        shareLink: true,
        member: true,
        relationType: true,
        priorityLevel: true,
        field: true,
        fieldOption: true,
        machine: true,
        account: true,
      },
      undoWindowMs: 4000,
    });
  });
});

describe("confirmPolicy", () => {
  it("asks before every kind of delete by default", () => {
    for (const kind of DELETE_KINDS) {
      expect(confirmPolicy(kind, DEFAULT_FEEDBACK)).toBe(true);
    }
  });

  it("deletes a kind switched off at once, and only that kind", () => {
    const feedback: FeedbackPolicy = {
      ...DEFAULT_FEEDBACK,
      confirmDeletes: { ...DEFAULT_FEEDBACK.confirmDeletes, status: false },
    };

    expect(confirmPolicy("status", feedback)).toBe(false);
    expect(confirmPolicy("label", feedback)).toBe(true);
  });

  it("asks for a kind the policy does not name", () => {
    const withoutComment = Object.fromEntries(
      Object.entries(DEFAULT_FEEDBACK.confirmDeletes).filter(
        ([kind]) => kind !== "comment"
      )
    );
    const feedback = {
      ...DEFAULT_FEEDBACK,
      confirmDeletes: withoutComment,
    } as FeedbackPolicy;

    expect(confirmPolicy("comment", feedback)).toBe(true);
  });
});

describe("shownSections", () => {
  const ids = (sections: { id: string; shown: boolean }[]) =>
    shownSections(sections).map((section) => section.id);

  it("keeps the list's order and drops what it hides", () => {
    expect(
      ids([
        { id: "b", shown: true },
        { id: "a", shown: false },
        { id: "c", shown: true },
      ])
    ).toEqual(["b", "c"]);
  });

  it("lists a section named twice once, as it first stands", () => {
    expect(
      ids([
        { id: "a", shown: true },
        { id: "b", shown: true },
        { id: "a", shown: true },
        { id: "b", shown: false },
      ])
    ).toEqual(["a", "b"]);
  });

  it("hands back each entry whole, so a list can carry more than id and shown", () => {
    const sidebar = [{ id: "tracks", shown: true, collapsed: true }];

    expect(shownSections(sidebar)).toEqual(sidebar);
  });
});
