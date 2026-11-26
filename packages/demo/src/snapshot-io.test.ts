import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertInWorkspace,
  assertNotOwnerDatabase,
  assertWorkspaceEnv,
  demoNotesKey,
  writeDemoEnv,
} from "./snapshot-io";
import { readEnvValue } from "./snapshot-lib";

/** A throwaway main checkout and worktree, each with a server env. */
let dir: string;
let main: string;
let workspaceEnv: string;

const serverEnv = (root: string) => join(root, "apps/server/.env");

async function writeEnv(root: string, text: string) {
  await mkdir(join(root, "apps/server"), { recursive: true });
  await Bun.write(serverEnv(root), text);
}

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), "demo-snapshot-io-")));
  main = join(dir, "main");
  workspaceEnv = serverEnv(join(dir, "worktree"));
  await writeEnv(
    main,
    'DATABASE_URL="postgres://u:p@localhost:5432/projammr"\nNOTES_MASTER_KEY="main-key"\n'
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the workspace's own files", () => {
  const worktree = () => join(dir, "worktree");
  const mainStatic = () => join(main, "apps/server/static");

  beforeEach(async () => {
    await writeEnv(worktree(), 'DATABASE_URL="postgres://u:p@h/demo"\n');
    await mkdir(join(worktree(), "apps/server/static"), { recursive: true });
    await mkdir(mainStatic(), { recursive: true });
  });

  it("accepts the workspace's own server env and static dir", async () => {
    expect(await assertWorkspaceEnv(workspaceEnv, worktree())).toBe(
      workspaceEnv
    );
    const own = join(worktree(), "apps/server/static");
    expect(await assertInWorkspace(own, worktree())).toBe(own);
  });

  it("accepts a static dir a restore has yet to create", async () => {
    const fresh = join(worktree(), "apps/server/static/new");
    expect(await assertInWorkspace(fresh, worktree())).toBe(fresh);
  });

  it("refuses another checkout's env and static dir by name", async () => {
    await expect(
      assertWorkspaceEnv(serverEnv(main), worktree())
    ).rejects.toThrow("not this workspace's server env");
    await expect(assertInWorkspace(mainStatic(), worktree())).rejects.toThrow(
      "outside this workspace"
    );
  });

  it("refuses an env file or static dir that is itself a symlink", async () => {
    await rm(workspaceEnv);
    await symlink(serverEnv(main), workspaceEnv);
    await expect(assertWorkspaceEnv(workspaceEnv, worktree())).rejects.toThrow(
      "is a symlink"
    );

    const linked = join(worktree(), "apps/server/linked-static");
    await symlink(join(worktree(), "apps/server/static"), linked);
    await expect(assertInWorkspace(linked, worktree())).rejects.toThrow(
      "is a symlink"
    );
  });

  it("refuses a path a symlinked directory above it leads into the main checkout", async () => {
    const into = join(worktree(), "apps/main-server");
    await symlink(join(main, "apps/server"), into);
    await expect(
      assertInWorkspace(join(into, "static"), worktree())
    ).rejects.toThrow("outside this workspace");
  });
});

describe("demoNotesKey", () => {
  it("returns a key demo-env wrote", async () => {
    expect(await demoNotesKey('NOTES_MASTER_KEY="demo-key"\n', main)).toBe(
      "demo-key"
    );
  });

  it("refuses the key a worktree's env copied from the main checkout", async () => {
    await expect(
      demoNotesKey('NOTES_MASTER_KEY="main-key"\n', main)
    ).rejects.toThrow("run `demo-env` first");
  });

  it("refuses when the main checkout has no env to compare with", async () => {
    await expect(
      demoNotesKey('NOTES_MASTER_KEY="demo-key"\n', join(dir, "nowhere"))
    ).rejects.toThrow("could not read the main checkout's NOTES_MASTER_KEY");
  });
});

describe("assertNotOwnerDatabase", () => {
  it("allows a database other than the main checkout's", async () => {
    await assertNotOwnerDatabase("projammr_demo", main);
  });

  it("refuses the main checkout's database", async () => {
    await expect(assertNotOwnerDatabase("projammr", main)).rejects.toThrow(
      "not a demo database"
    );
  });

  it("refuses when the main checkout's env is missing or names no database", async () => {
    await expect(
      assertNotOwnerDatabase("projammr_demo", join(dir, "nowhere"))
    ).rejects.toThrow("could not read the main checkout's DATABASE_URL");

    await writeEnv(main, 'NOTES_MASTER_KEY="main-key"\n');
    await expect(assertNotOwnerDatabase("projammr_demo", main)).rejects.toThrow(
      "could not read the main checkout's DATABASE_URL"
    );
  });
});

describe("writeDemoEnv", () => {
  it("writes a demo notes key, and no zone, into an env naming a demo database", async () => {
    await writeEnv(
      join(dir, "worktree"),
      'DATABASE_URL="postgres://u:p@localhost:5432/projammr_demo"\nNOTES_MASTER_KEY="main-key"\n'
    );

    await writeDemoEnv(workspaceEnv, "demo-key", main);

    const text = await Bun.file(workspaceEnv).text();
    expect(readEnvValue(text, "NOTES_MASTER_KEY")).toBe("demo-key");
    expect(readEnvValue(text, "TZ")).toBeUndefined();
  });

  it("refuses, and leaves alone, an env naming the main checkout's database", async () => {
    const before =
      'DATABASE_URL="postgres://u:p@localhost:5432/projammr"\nNOTES_MASTER_KEY="main-key"\n';
    await writeEnv(join(dir, "worktree"), before);

    await expect(writeDemoEnv(workspaceEnv, "demo-key", main)).rejects.toThrow(
      "not a demo database"
    );
    expect(await Bun.file(workspaceEnv).text()).toBe(before);
  });
});
