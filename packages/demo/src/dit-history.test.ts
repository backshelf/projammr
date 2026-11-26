import { describe, expect, it } from "bun:test";
import { recordBytes } from "@workspace/dit/pack";
import { planPush, standInSet } from "./dit-history";
import type { HistoricSave } from "./session-history";

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 4, 1, 10);

const meta = { samplePaths: null } as unknown as HistoricSave["meta"];

/** Saves each `gap` after the last, closing a commit where `kinds` says "milestone". */
const savesOf = (kinds: ("milestone" | "between")[], gap = 60 * MINUTE) =>
  kinds.map((kind, i): HistoricSave =>
    kind === "milestone"
      ? { fileUpdatedAt: T0 + i * gap, kind, message: `commit ${i}`, meta }
      : { fileUpdatedAt: T0 + i * gap, kind, meta }
  );

const stand = standInSet();

describe("standInSet", () => {
  it("is a tree, a side list and the leaves, each record named by its own hash", () => {
    expect(stand.records.length).toBeGreaterThanOrEqual(3);
    expect(stand.objects).toEqual(stand.records.map((r) => r.hash));
    expect(stand.objects).toContain(stand.tree);
    expect(stand.objects).toContain(stand.side);
    expect(stand.objects.every((h) => /^[0-9a-f]{64}$/.test(h))).toBe(true);
    for (const record of stand.records) {
      const bytes = recordBytes(record);
      expect(Buffer.from(bytes.subarray(0, 32)).toString("hex")).toBe(
        record.hash
      );
      expect(bytes.byteLength).toBe(37 + record.frame.length);
    }
  });
});

describe("planPush", () => {
  const kinds = [
    "milestone",
    "between",
    "between",
    "milestone",
    "between",
    "milestone",
  ] as const;
  const saves = savesOf([...kinds]);
  const plan = planPush("demo", "Studio", saves, stand);

  it("pushes every save under a hash of its own that names the stand-in objects", () => {
    expect(plan.saves).toHaveLength(saves.length);
    expect(new Set(plan.saves.map((s) => s.hash)).size).toBe(saves.length);
    expect(plan.saves.every((s) => /^[0-9a-f]{64}$/.test(s.hash))).toBe(true);
    for (const save of plan.saves) {
      expect(save.tree).toBe(stand.tree);
      expect(save.side).toBe(stand.side);
      expect(save.machineName).toBe("Studio");
    }
  });

  it("cuts a commit at each milestone, holding the saves since the one before", () => {
    expect(plan.commits.map((c) => c.message)).toEqual([
      "commit 0",
      "commit 3",
      "commit 5",
    ]);
    expect(plan.commits.map((c) => c.saves.length)).toEqual([1, 3, 2]);
    expect(plan.commits.flatMap((c) => c.saves.map((s) => s.hash))).toEqual(
      plan.saves.map((s) => s.hash)
    );
    for (const [i, commit] of plan.commits.entries()) {
      expect(commit.saves.at(-1)!.hash).toBe(commit.saveHash);
      expect(commit.parentHash).toBe(plan.commits[i - 1]?.hash ?? null);
      expect(commit.kind).toBe("user");
      for (const save of commit.saves) {
        expect(save.objects).toContain(stand.tree);
        expect(save.objects).toContain(stand.side);
      }
    }
  });

  it("dates each commit just after its own save", () => {
    const own = new Map(plan.saves.map((s) => [s.hash, s.fileUpdatedAt]));
    for (const commit of plan.commits)
      expect(commit.committedAt).toBe(own.get(commit.saveHash)! + 1);
  });

  it("gives each save a sitting that ends at it and starts after the save before", () => {
    expect(plan.segments).toHaveLength(saves.length);
    for (const [i, segment] of plan.segments.entries()) {
      expect(segment.endedAt).toBe(saves[i]!.fileUpdatedAt);
      expect(segment.startedAt).toBeLessThan(segment.endedAt);
      expect(segment.startedAt).toBeGreaterThanOrEqual(
        saves[i - 1]?.fileUpdatedAt ?? 0
      );
      expect(segment).toMatchObject({ branch: "main", source: "saves" });
    }
  });

  it("lays the plan out the same way every run", () => {
    expect(planPush("demo", "Studio", saves, stand)).toEqual(plan);
  });

  it("refuses history whose last save is not a milestone", () => {
    expect(() =>
      planPush("demo", "Studio", savesOf(["milestone", "between"]), stand)
    ).toThrow("not a milestone");
  });
});
