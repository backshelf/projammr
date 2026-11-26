import { describe, expect, test } from "bun:test";

import type { RepoRow } from "./ipc";
import { matching, recentFirst } from "./repo-list";

function repo(name: string, lastActiveAt: number | null): RepoRow {
  return {
    path: `/Music/${name}`,
    name,
    unreachable: null,
    busy: false,
    lastCommit: null,
    lastActiveAt,
    webPath: null,
  };
}

describe("recentFirst", () => {
  test("puts the newest activity first, repos with none last, ties by name", () => {
    const sorted = recentFirst([
      repo("quiet b", null),
      repo("old", 100),
      repo("quiet a", null),
      repo("new", 900),
    ]);

    expect(sorted.map((r) => r.name)).toEqual([
      "new",
      "old",
      "quiet a",
      "quiet b",
    ]);
  });

  test("leaves the list it was given as it was", () => {
    const given = [repo("old", 100), repo("new", 900)];
    recentFirst(given);

    expect(given.map((r) => r.name)).toEqual(["old", "new"]);
  });
});

describe("matching", () => {
  const repos = [repo("Science Project", 1), repo("Album", 2)];

  test("finds a name or a folder in any case", () => {
    expect(matching(repos, "sci").map((r) => r.name)).toEqual([
      "Science Project",
    ]);
    expect(matching(repos, "/music/alb").map((r) => r.name)).toEqual(["Album"]);
  });

  test("keeps every repo for a blank filter", () => {
    expect(matching(repos, "  ")).toHaveLength(2);
  });
});
