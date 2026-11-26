import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { notesMasterKeys } from "../../lib/env.js";
import {
  type MasterKeys,
  scopeFor,
  scopeKey,
  seal,
  unwrap,
} from "../../lib/notes-crypto.js";
import { db } from "../index.js";
import { users } from "../schema/auth.js";
import { notes } from "../schema/notes.js";
import {
  assertNotesKeyOpensCurrentVersion,
  countNotesOnPreviousKeyVersion,
  rotateNotesKeyBatch,
} from "./notes-key-rotation.js";

// The rotation scans the whole table for rows below the current version, and
// other test files leave notes wrapped under the real key at version 1: the
// keys here sit at 1 and the "older" rows at 0, which nothing else writes.
const CURRENT_VERSION = 1;
const OLD_VERSION = 0;

let counter = 0;
const unique = (label: string) =>
  `${label}-${Date.now()}-${counter++}-${Math.random().toString(36).slice(2, 6)}`.replace(
    /[^a-zA-Z0-9-]/g,
    ""
  );

let author: string;
const seededUsers: string[] = [];
const seededNotes: number[] = [];

async function seedUser(label: string): Promise<string> {
  const id = unique(label);
  await db
    .insert(users)
    .values({ id, name: label, email: `${id}@example.com` });
  seededUsers.push(id);
  return id;
}

/**
 * Inserts a note wrapped under `key` at `version` directly — a test controls
 * a row's starting key version this way, which nothing the app does through
 * `createNote` (always the current version) can produce.
 */
async function seedNote(
  key: Buffer,
  version: number
): Promise<{ id: number; dataKey: Buffer }> {
  const scope = scopeFor(author, null);
  const dataKey = randomBytes(32);
  const [row] = await db
    .insert(notes)
    .values({
      authorId: author,
      keyScope: scope,
      keyVersion: version,
      wrappedKey: seal(scopeKey(key, scope, version), dataKey),
      body: seal(dataKey, Buffer.from("[]")),
      summary: seal(
        dataKey,
        Buffer.from(JSON.stringify({ title: "t", preview: "p" }))
      ),
    })
    .returning({ id: notes.id });
  seededNotes.push(row!.id);
  return { id: row!.id, dataKey };
}

beforeAll(async () => {
  author = await seedUser("Rotation");
});

afterAll(async () => {
  if (seededNotes.length > 0) {
    await db.delete(notes).where(inArray(notes.id, seededNotes));
  }
  for (const id of seededUsers) {
    await db.delete(users).where(eq(users.id, id));
  }
});

describe("countNotesOnPreviousKeyVersion", () => {
  it("counts only notes wrapped under a key version older than the current one", async () => {
    const keys: MasterKeys = {
      current: randomBytes(32),
      previous: null,
      version: CURRENT_VERSION,
    };
    const before = await countNotesOnPreviousKeyVersion(keys);

    const older = await seedNote(randomBytes(32), OLD_VERSION);
    const current = await seedNote(randomBytes(32), CURRENT_VERSION);
    try {
      expect(await countNotesOnPreviousKeyVersion(keys)).toBe(before + 1);
    } finally {
      // Cleaned up immediately, not just in afterAll: rotateNotesKeyBatch
      // below scans the whole table by key version, so a row left behind
      // here — wrapped under a key no other test knows — would poison it.
      await db.delete(notes).where(inArray(notes.id, [older.id, current.id]));
    }
  });
});

describe("rotateNotesKeyBatch", () => {
  it(
    "rotates in batches, resumes after an interruption, and leaves both " +
      "versions readable during the window",
    async () => {
      const previous = randomBytes(32);
      const current = randomBytes(32);
      const keys: MasterKeys = {
        current,
        previous,
        version: CURRENT_VERSION,
      };

      const seeded = await Promise.all(
        Array.from({ length: 5 }, () => seedNote(previous, OLD_VERSION))
      );
      const ids = seeded.map((n) => n.id);
      const dataKeyOf = new Map(seeded.map((n) => [n.id, n.dataKey]));

      try {
        // A batch smaller than the seeded count leaves rows behind — the
        // "interrupted mid-way" state a real run can be killed in.
        const firstBatch = await rotateNotesKeyBatch(2, keys);
        expect(firstBatch).toBe(2);

        const midway = await db
          .select()
          .from(notes)
          .where(inArray(notes.id, ids));
        expect(
          midway.filter((row) => row.keyVersion === CURRENT_VERSION)
        ).toHaveLength(2);
        expect(
          midway.filter((row) => row.keyVersion === OLD_VERSION)
        ).toHaveLength(3);

        // Every row is readable regardless of which side of the rotation it's on.
        for (const row of midway) {
          expect(unwrap(keys, row)).toEqual(dataKeyOf.get(row.id)!);
        }

        // "Resume": call again until nothing is left — idempotent, since a
        // row already on the current version is never selected again.
        let moved = firstBatch;
        while (moved > 0) {
          moved = await rotateNotesKeyBatch(2, keys);
        }
        expect(
          (await db.select().from(notes).where(inArray(notes.id, ids))).every(
            (row) => row.keyVersion === CURRENT_VERSION
          )
        ).toBe(true);

        const finished = await db
          .select()
          .from(notes)
          .where(inArray(notes.id, ids));
        for (const row of finished) {
          expect(
            unwrap({ current, previous: null, version: CURRENT_VERSION }, row)
          ).toEqual(dataKeyOf.get(row.id)!);
        }
      } finally {
        await db.delete(notes).where(inArray(notes.id, ids));
      }
    }
  );

  it("fails naming NOTES_MASTER_KEY_PREVIOUS, and touches nothing, when a row needs a previous key that isn't configured", async () => {
    const current = randomBytes(32);
    const noPrevious: MasterKeys = {
      current,
      previous: null,
      version: CURRENT_VERSION,
    };
    const { id } = await seedNote(randomBytes(32), OLD_VERSION);

    try {
      await expect(rotateNotesKeyBatch(500, noPrevious)).rejects.toThrow(
        /NOTES_MASTER_KEY_PREVIOUS/
      );

      const [row] = await db.select().from(notes).where(eq(notes.id, id));
      expect(row?.keyVersion).toBe(OLD_VERSION);
    } finally {
      await db.delete(notes).where(eq(notes.id, id));
    }
  });
});

describe("assertNotesKeyOpensCurrentVersion", () => {
  // A version no other test writes, so the checks for notes on and above it
  // only ever see this file's rows. Every other file's notes sit below it, at
  // version 1, so these keys carry a previous key — a rotation in progress —
  // which keeps the check for notes below the current version out of them.
  const BOOT_VERSION = 32000;
  const keysAt = (current: Buffer, version: number): MasterKeys => ({
    current,
    previous: randomBytes(32),
    version,
  });

  it("resolves when the key opens a note on the current version", async () => {
    const key = randomBytes(32);
    const { id } = await seedNote(key, BOOT_VERSION);
    try {
      await expect(
        assertNotesKeyOpensCurrentVersion(keysAt(key, BOOT_VERSION))
      ).resolves.toBeUndefined();
    } finally {
      await db.delete(notes).where(eq(notes.id, id));
    }
  });

  it("rejects, saying what is wrong and what to do, when a different key is set", async () => {
    const { id } = await seedNote(randomBytes(32), BOOT_VERSION);
    try {
      const check = assertNotesKeyOpensCurrentVersion(
        keysAt(randomBytes(32), BOOT_VERSION)
      );
      await expect(check).rejects.toThrow(/cannot open the notes/);
      await expect(check).rejects.toThrow(/NOTES_MASTER_KEY_PREVIOUS/);
      await expect(check).rejects.toThrow(
        new RegExp(`NOTES_KEY_VERSION to ${BOOT_VERSION + 1}`)
      );
    } finally {
      await db.delete(notes).where(eq(notes.id, id));
    }
  });

  it("rejects, naming the version to set, when notes sit above the configured one", async () => {
    const { id } = await seedNote(randomBytes(32), BOOT_VERSION);
    try {
      const check = assertNotesKeyOpensCurrentVersion(
        keysAt(randomBytes(32), BOOT_VERSION - 1)
      );
      await expect(check).rejects.toThrow(
        new RegExp(`Set NOTES_KEY_VERSION to ${BOOT_VERSION}`)
      );
    } finally {
      await db.delete(notes).where(eq(notes.id, id));
    }
  });

  it("resolves when no note is on the current version", async () => {
    await expect(
      assertNotesKeyOpensCurrentVersion(
        keysAt(randomBytes(32), BOOT_VERSION + 1)
      )
    ).resolves.toBeUndefined();
  });

  // The checks for notes below the current version run at CURRENT_VERSION
  // under the app's own key: every other file's notes are on that version and
  // open under it, and the only notes below it are this test's own, at
  // OLD_VERSION.
  it.each([
    [1, "1 note is"],
    [2, "2 notes are"],
  ])(
    "rejects, naming the count (%i) and the fix, when notes sit below the current version and NOTES_MASTER_KEY_PREVIOUS is unset",
    async (count, stored) => {
      const seeded = await Promise.all(
        Array.from({ length: count }, () =>
          seedNote(randomBytes(32), OLD_VERSION)
        )
      );
      const ids = seeded.map((n) => n.id);
      try {
        const check = assertNotesKeyOpensCurrentVersion({
          current: notesMasterKeys.current,
          previous: null,
          version: CURRENT_VERSION,
        });
        await expect(check).rejects.toThrow(
          new RegExp(
            `^${stored} stored under a NOTES_KEY_VERSION below the configured ${CURRENT_VERSION}`
          )
        );
        await expect(check).rejects.toThrow(
          /Put the old key back in NOTES_MASTER_KEY_PREVIOUS/
        );
        await expect(check).rejects.toThrow(/rotate-notes-key/);
      } finally {
        await db.delete(notes).where(inArray(notes.id, ids));
      }
    }
  );

  it("resolves when notes sit below the current version and NOTES_MASTER_KEY_PREVIOUS is set", async () => {
    const previous = randomBytes(32);
    const { id } = await seedNote(previous, OLD_VERSION);
    try {
      await expect(
        assertNotesKeyOpensCurrentVersion({
          current: notesMasterKeys.current,
          previous,
          version: CURRENT_VERSION,
        })
      ).resolves.toBeUndefined();
    } finally {
      await db.delete(notes).where(eq(notes.id, id));
    }
  });
});
