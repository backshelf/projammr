import { describe, expect, it } from "bun:test";
import { catalogue } from "./catalogue";
import {
  canWrite,
  coverPath,
  findCollection,
  findTrack,
  GLOBAL_STATUSES,
  primaryIndex,
  roleIn,
  versionsOf,
} from "./lookup";
import type { DemoComment, DemoProject } from "./model";

const accounts = new Set(catalogue.accounts.map((a) => a.key));

const duplicates = (values: unknown[]) =>
  values.filter((v, i) => values.indexOf(v) !== i);

/** Every comment and reply written in a project, with where it sits. */
function commentsIn(project: DemoProject) {
  const out: { where: string; comment: DemoComment }[] = [];
  const add = (where: string, list: DemoComment[] = []) =>
    list.forEach((comment) => out.push({ where, comment }));
  add(project.key, project.comments);
  for (const t of project.tracks) {
    add(t.key, t.comments);
    t.versions.forEach((v) => add(v.file, v.pins));
  }
  project.collections.forEach((c) => add(c.key, c.comments));
  project.sessions.forEach((s) => add(s.key, s.comments));
  return out.flatMap(({ where, comment }) => [
    { where, author: comment.author },
    ...(comment.replies ?? []).map((r) => ({ where, author: r.author })),
  ]);
}

describe("the demo catalogue", () => {
  it("names each account, project, track, collection and session once", () => {
    expect(duplicates(catalogue.accounts.map((a) => a.key))).toEqual([]);
    expect(duplicates(catalogue.accounts.map((a) => a.email))).toEqual([]);
    expect(duplicates(catalogue.projects.map((p) => p.key))).toEqual([]);
    for (const p of catalogue.projects) {
      expect(duplicates(p.tracks.map((t) => t.key))).toEqual([]);
      expect(duplicates(p.collections.map((c) => c.key))).toEqual([]);
      expect(duplicates(p.sessions.map((s) => s.key))).toEqual([]);
    }
  });

  it("gives every project an owner and members who have accounts", () => {
    for (const p of catalogue.projects) {
      expect(accounts.has(p.owner)).toBe(true);
      for (const m of p.members) {
        expect(accounts.has(m.account)).toBe(true);
        expect(m.account).not.toBe(p.owner);
      }
      const invited = p.invites.map((i) => i.email);
      const memberEmails = catalogue.accounts
        .filter((a) => roleIn(p, a.key))
        .map((a) => a.email);
      expect(invited.filter((e) => memberEmails.includes(e))).toEqual([]);
    }
  });

  it("builds a project only once its owner can have an account", () => {
    // The first account signs up; everyone else joins through an invite to an
    // earlier-built project, so each owner must be reachable that way.
    const joined = new Set([catalogue.accounts[0]!.key]);
    const queue = [...catalogue.projects];
    while (queue.length) {
      const next = queue.findIndex((p) => joined.has(p.owner));
      expect(next).not.toBe(-1);
      const [p] = queue.splice(next, 1);
      p!.members.forEach((m) => joined.add(m.account));
    }
  });

  it("uses statuses and labels its project defines", () => {
    for (const p of catalogue.projects) {
      const statuses = new Set<string>([
        ...GLOBAL_STATUSES,
        ...p.statuses.map((s) => s.name),
      ]);
      const labels = new Set(p.labels.map((l) => l.name));
      for (const item of [...p.tracks, ...p.collections]) {
        expect(statuses.has(item.status)).toBe(true);
        for (const label of item.labels) expect(labels.has(label)).toBe(true);
      }
      for (const s of p.statuses) {
        expect(s.percentage).toBeGreaterThanOrEqual(0);
        expect(s.percentage).toBeLessThanOrEqual(100);
        expect(s.colourHex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });

  it("points every cover at a file in fixtures/covers", async () => {
    const covers = catalogue.projects.flatMap((p) => [
      p.cover,
      ...p.tracks.map((t) => t.cover),
      ...p.collections.map((c) => c.cover),
    ]);
    for (const cover of new Set(covers)) {
      if (cover) expect(await Bun.file(coverPath(cover)).exists()).toBe(true);
    }
  });

  it("names each audio file once, as a plain demo file name", () => {
    const versions = [...versionsOf(catalogue)];
    expect(duplicates(versions.map((v) => v.version.file))).toEqual([]);
    for (const { version } of versions) {
      expect(version.file).toMatch(/^[a-z0-9-]+\.mp3$/);
      expect(version.durationMs).toBeGreaterThan(0);
    }
  });

  it("gives every track a version and a primary that exists", () => {
    for (const p of catalogue.projects) {
      for (const t of p.tracks) {
        expect(t.versions.length).toBeGreaterThan(0);
        expect(t.versions[primaryIndex(t)]).toBeDefined();
      }
    }
  });

  it("pins every timecoded comment inside its version", () => {
    for (const { version } of versionsOf(catalogue)) {
      for (const pin of version.pins) {
        expect(pin.atMs).toBeGreaterThanOrEqual(0);
        expect(pin.atMs).toBeLessThan(version.durationMs);
      }
    }
  });

  it("only lets members who can write comment, reply or write lyrics", () => {
    for (const p of catalogue.projects) {
      for (const { where, author } of commentsIn(p)) {
        expect({ where, author, canWrite: canWrite(p, author) }).toEqual({
          where,
          author,
          canWrite: true,
        });
      }
      for (const t of p.tracks) {
        if (t.lyrics) expect(canWrite(p, t.lyrics.author)).toBe(true);
      }
    }
  });

  it("resolves relations and collection running orders to tracks in the same project", () => {
    for (const p of catalogue.projects) {
      for (const t of p.tracks) {
        for (const r of t.relations ?? []) {
          expect(findTrack(p, r.to)).toBeDefined();
          expect(r.to).not.toBe(t.key);
        }
      }
      for (const c of p.collections) {
        expect(duplicates(c.tracks)).toEqual([]);
        for (const key of c.tracks) expect(findTrack(p, key)).toBeDefined();
        if (c.releaseDate) expect(c.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("orders each session's saves before its current one, each with a commit message", () => {
    for (const p of catalogue.projects) {
      for (const s of p.sessions) {
        expect(findTrack(p, s.track)).toBeDefined();
        expect(s.localPath.endsWith(".als")).toBe(true);
        expect(s.localPath.startsWith(`${s.home}/`)).toBe(true);
        const times = [
          ...s.history.map((m) => Date.parse(m.at)),
          Date.parse(s.savedAt),
        ];
        expect(times.every(Number.isFinite)).toBe(true);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(new Set(times).size).toBe(times.length);
        const messages = [...s.history.map((m) => m.message), s.savedMessage];
        expect(messages.every((m) => m.trim().length > 0)).toBe(true);
        expect(new Set(messages).size).toBe(messages.length);
      }
    }
  });

  it("resolves saved views to owners, statuses, labels and collections", () => {
    for (const p of catalogue.projects) {
      for (const v of p.savedViews) {
        expect(roleIn(p, v.owner)).toBeDefined();
        if (v.filter?.status) {
          expect([
            ...GLOBAL_STATUSES,
            ...p.statuses.map((s) => s.name),
          ]).toContain(v.filter.status);
        }
        if (v.filter?.label)
          expect(p.labels.map((l) => l.name)).toContain(v.filter.label);
        if (v.filter?.collection)
          expect(findCollection(p, v.filter.collection)).toBeDefined();
        if (v.sort)
          expect(v.sort).toMatch(
            /^[a-zA-Z]+\.(asc|desc)(,[a-zA-Z]+\.(asc|desc))*$/
          );
      }
    }
  });

  it("shares entities that exist and pins guest comments to a track on the page", () => {
    for (const link of catalogue.shareLinks) {
      const p = catalogue.projects.find((x) => x.key === link.project);
      expect(p).toBeDefined();
      expect(canWrite(p!, link.owner)).toBe(true);
      const onPage =
        link.entity.kind === "collection"
          ? (findCollection(p!, link.entity.key)?.tracks ?? [])
          : [link.entity.key];
      expect(onPage.length).toBeGreaterThan(0);
      for (const c of link.guestComments) {
        const key = c.track ?? link.entity.key;
        expect(onPage).toContain(key);
        const track = findTrack(p!, key)!;
        if (c.atMs !== undefined) {
          expect(c.atMs).toBeLessThan(
            track.versions[primaryIndex(track)]!.durationMs
          );
        }
      }
    }
  });

  it("gives every notebook note an author with an account", () => {
    for (const note of catalogue.notes)
      expect(accounts.has(note.author)).toBe(true);
  });
});
