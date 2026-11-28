import {
  byNewest,
  duplicateFlagLabel,
  duplicateOfVersion,
  fromCommitHref,
  fromCommitLabel,
  primaryStarLabel,
  versionRowLine,
} from "@/components/track-audio/version-rows";
import { defaultFormatters } from "@workspace/ui/lib/formatters";
import { describe, expect, it } from "bun:test";

const format = defaultFormatters("UTC");

const scanned = (lufs: number | null) => ({
  lufs,
  asset: {
    localFileCreatedAt: "2026-09-14T10:00:00Z",
    createdAt: "2026-09-15T10:00:00Z",
  },
});

// The short month is ICU data: Bun on Linux ships a CLDR that writes "Sept",
// Bun on macOS uses the system's, which writes "Sep".
describe("versionRowLine", () => {
  it("reads the loudness and the date the file was made", () => {
    expect(versionRowLine(scanned(-16.3), format)).toMatch(
      /^−16\.3 LUFS · 14 Sept? 2026$/
    );
  });

  it("omits the loudness until the scan has run", () => {
    expect(versionRowLine(scanned(null), format)).toMatch(/^14 Sept? 2026$/);
  });

  it("falls back to the upload date when the file carries none", () => {
    expect(
      versionRowLine(
        {
          lufs: null,
          asset: {
            localFileCreatedAt: null,
            createdAt: "2026-09-15T10:00:00Z",
          },
        },
        format
      )
    ).toMatch(/^15 Sept? 2026$/);
  });
});

describe("byNewest", () => {
  it("puts the highest version first and leaves the input alone", () => {
    const audios = [{ version: 1 }, { version: 3 }, { version: 2 }];

    expect(byNewest(audios).map((audio) => audio.version)).toEqual([3, 2, 1]);
    expect(audios.map((audio) => audio.version)).toEqual([1, 3, 2]);
  });
});

describe("primaryStarLabel", () => {
  it("names the version the star would promote", () => {
    expect(primaryStarLabel(2, false)).toBe("Make v2 the primary version");
  });

  it("states the version that is already primary", () => {
    expect(primaryStarLabel(2, true)).toBe("v2 is the primary version");
  });
});

describe("duplicateFlagLabel", () => {
  it("names the version the audio duplicates", () => {
    expect(duplicateFlagLabel(3)).toBe("same audio as v3");
  });
});

describe("duplicateOfVersion", () => {
  const audios = [
    { id: 10, version: 1 },
    { id: 11, version: 2 },
    { id: 12, version: 3 },
  ];

  it("finds the version a duplicate id names", () => {
    expect(duplicateOfVersion(11, audios)).toBe(2);
  });

  it("returns null with no duplicate id", () => {
    expect(duplicateOfVersion(null, audios)).toBeNull();
    expect(duplicateOfVersion(undefined, audios)).toBeNull();
  });

  it("returns null for an id outside the given versions", () => {
    expect(duplicateOfVersion(99, audios)).toBeNull();
  });
});

const bounced = (
  kind: "user" | "checkpoint",
  over: { branch?: string; commit?: null } = {}
) => ({
  saveId: 90,
  sessionId: 812,
  savedAt: "2026-09-14T10:00:00.000Z",
  commit:
    over.commit === null
      ? null
      : {
          id: 41,
          message: "added strings",
          committedAt: "2026-09-14T10:05:00.000Z",
          branch: over.branch ?? "main",
          kind,
        },
});

describe("fromCommitLabel", () => {
  it("names the commit a version was bounced from", () => {
    expect(fromCommitLabel(bounced("user"))).toBe(
      "from commit 'added strings'"
    );
  });

  it("says nothing for a version no commit recorded", () => {
    expect(fromCommitLabel(null)).toBeNull();
    expect(fromCommitLabel(undefined)).toBeNull();
    expect(fromCommitLabel(bounced("user", { commit: null }))).toBeNull();
  });
});

describe("fromCommitHref", () => {
  const where = { projectId: 5, trackId: 7 };

  it("opens the track's Studio history drawer at the commit", () => {
    expect(fromCommitHref(bounced("user"), where)).toBe(
      "/project/5/track/7?studio=history&session=812&to=90"
    );
  });

  it("opens the folded checkpoints for a checkpoint", () => {
    expect(fromCommitHref(bounced("checkpoint"), where)).toBe(
      "/project/5/track/7?studio=history&session=812&to=90&checkpoints=1"
    );
  });

  it("has no link without a commit or for a branch the log does not show", () => {
    expect(fromCommitHref(null, where)).toBeNull();
    expect(fromCommitHref(bounced("user", { commit: null }), where)).toBeNull();
    expect(
      fromCommitHref(bounced("user", { branch: "alt" }), where)
    ).toBeNull();
  });
});
