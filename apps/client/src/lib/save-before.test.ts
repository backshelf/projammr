import type { SessionSave } from "@workspace/api/api";
import { describe, expect, it } from "bun:test";
import { latestSaveInfo, saveBefore } from "./save-before";

const save = (
  id: number,
  fileUpdatedAt: string,
  machineName: string | null = null
): SessionSave => ({
  id,
  createdAt: fileUpdatedAt,
  updatedAt: fileUpdatedAt,
  sessionId: 1,
  projectId: 1,
  fileUpdatedAt,
  fingerprint: null,
  machineName,
  machineId: null,
  source: "scan",
  meta: null,
  hash: null,
  xmlHash: null,
  tree: null,
  side: null,
  raw: null,
  viewOnly: false,
  unreadable: false,
  contentState: "none",
  branchId: null,
});

const LATEST = save(3, "2026-09-18T12:47:00.000Z", "Studio Mac");
const MIDDLE = save(2, "2026-09-14T10:57:00.000Z", "Laptop");
const OLDEST = save(1, "2026-09-11T12:08:00.000Z", "Laptop");

describe("saveBefore", () => {
  it("passes over the current file's own save to the one it followed", () => {
    expect(
      saveBefore([LATEST, MIDDLE, OLDEST], "2026-09-18T12:47:00.000Z")
    ).toBe(MIDDLE);
  });

  it("matches the current file by time, however the time is written", () => {
    expect(saveBefore([LATEST, MIDDLE], "2026-09-18T22:47:00+10:00")).toBe(
      MIDDLE
    );
  });

  it("takes the newest save when the current file's own was never recorded", () => {
    expect(saveBefore([LATEST, MIDDLE], "2026-09-19T08:00:00.000Z")).toBe(
      LATEST
    );
  });

  it("finds nothing before a set's first save", () => {
    expect(saveBefore([OLDEST], "2026-09-11T12:08:00.000Z")).toBeUndefined();
  });

  it("finds nothing for a session with no file", () => {
    expect(saveBefore([LATEST, MIDDLE], null)).toBeUndefined();
  });
});

describe("latestSaveInfo", () => {
  it("falls back to the newest save's timestamp and machine for dit sessions", () => {
    const info = latestSaveInfo(
      { localFileUpdatedAt: null, localFileMachineName: null },
      [LATEST, MIDDLE, OLDEST]
    );

    expect(info.savedAt).toBe(LATEST.fileUpdatedAt);
    expect(info.machineName).toBe("Studio Mac");
    expect(info.previous).toBe(MIDDLE);
  });

  it("prefers session local file fields when present", () => {
    const info = latestSaveInfo(
      {
        localFileUpdatedAt: "2026-09-19T08:00:00.000Z",
        localFileMachineName: "Booth Mac",
      },
      [LATEST, MIDDLE]
    );

    expect(info.savedAt).toBe("2026-09-19T08:00:00.000Z");
    expect(info.machineName).toBe("Booth Mac");
    expect(info.previous).toBe(LATEST);
  });

  it("returns nulls and no previous save when a dit session has no saves", () => {
    const info = latestSaveInfo(
      { localFileUpdatedAt: null, localFileMachineName: null },
      []
    );

    expect(info.savedAt).toBeNull();
    expect(info.machineName).toBeNull();
    expect(info.previous).toBeUndefined();
  });
});
