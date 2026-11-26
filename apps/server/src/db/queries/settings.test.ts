import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import type { RegistrationMode } from "@workspace/settings/groups/instance-access";
import { eq } from "drizzle-orm";
import { db } from "../index.js";
import { instanceSettingValues } from "../schema/settings.js";
import { invites, projects } from "../schema/projects.js";
import { mkUserRow, withMigratedDatabase } from "../../test/database.js";
import {
  restoreInstancePolicy,
  stubInstancePolicy,
} from "../../test/instance-policy.js";
import {
  admitSignUp,
  cachedRegistrationMode,
  forgetInstanceRows,
  instanceRows,
  setRegistration,
} from "./settings.js";

/**
 * Registration as the instance holds it. The sign-up tests each run against a
 * database of their own: a first sign-up and a single-admin instance are
 * states the shared development database left behind long ago and that no
 * test could restore without breaking every other one. The cache tests read
 * the shared instance's own row, which is why this file runs in the serial
 * phase.
 */
type Database = typeof db;

const REGISTRATION = "instance-access.registration";

/** Mirrors `FIRST_ADMIN_CLAIM_KEY` in `settings.ts`, a key no group registers. */
const FIRST_ADMIN_CLAIM = "bootstrap.firstAdminClaim";

/**
 * The stored registration row's value. A freshly migrated database holds one,
 * `open`: the migrations seed it before folding it into the settings rows.
 */
const storedRegistration = async (database: Database) => {
  const [row] = await database
    .select({ value: instanceSettingValues.value })
    .from(instanceSettingValues)
    .where(eq(instanceSettingValues.key, REGISTRATION));
  return row?.value;
};

/** Writes the row as it stands, whether or not the registry accepts the value. */
const setRegistrationDirectly = (
  database: Database,
  registration: RegistrationMode | "invite-only"
) =>
  database
    .insert(instanceSettingValues)
    .values({ key: REGISTRATION, value: registration })
    .onConflictDoUpdate({
      target: instanceSettingValues.key,
      set: { value: registration },
    });

/** Writes the first-admin claim directly, backdating it to simulate staleness. */
const setClaimDirectly = (
  database: Database,
  email: string,
  updatedAt = new Date()
) =>
  database
    .insert(instanceSettingValues)
    .values({ key: FIRST_ADMIN_CLAIM, value: { email }, updatedAt })
    .onConflictDoUpdate({
      target: instanceSettingValues.key,
      set: { value: { email }, updatedAt },
    });

/** An unexpired, unaccepted invite for `email`, with the project it names. */
async function mkInvite(database: Database, email: string): Promise<void> {
  const [project] = await database
    .insert(projects)
    .values({ name: "Invited project" })
    .returning({ id: projects.id });

  await database.insert(invites).values({
    projectId: project!.id,
    email,
    token: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
  });
}

describe("admitSignUp", () => {
  it("makes the first account the instance admin and closes registration", async () => {
    await withMigratedDatabase(async (database) => {
      expect(await storedRegistration(database)).toBe("open");

      expect(await admitSignUp("first@example.com", database)).toBe("admin");

      expect(await storedRegistration(database)).toBe("closed");
    });
  }, 30_000);

  it("gives a concurrent pair of first sign-ups exactly one admin", async () => {
    await withMigratedDatabase(async (database) => {
      const admissions = await Promise.all([
        admitSignUp("one@example.com", database),
        admitSignUp("two@example.com", database),
      ]);

      expect(admissions.filter((role) => role === "admin")).toHaveLength(1);
      // The instance closed behind the first of them, and the second holds no
      // invite, so it is refused rather than admitted as an ordinary account.
      expect(admissions.filter((role) => role === null)).toHaveLength(1);
    });
  }, 30_000);

  it("does not count a share-page guest as the first account", async () => {
    await withMigratedDatabase(async (database) => {
      await mkUserRow(database, { isAnonymous: true });

      expect(await admitSignUp("first@example.com", database)).toBe("admin");
    });
  }, 30_000);

  it("counts an account whose isAnonymous is null as a real account", async () => {
    await withMigratedDatabase(async (database) => {
      await mkUserRow(database, { isAnonymous: null });

      expect(await admitSignUp("second@example.com", database)).toBe("user");
      expect(await storedRegistration(database)).toBe("open");
    });
  }, 30_000);

  it("admits anyone while registration is open", async () => {
    await withMigratedDatabase(async (database) => {
      await mkUserRow(database, { instanceRole: "admin" });
      await setRegistrationDirectly(database, "open");

      expect(await admitSignUp("stranger@example.com", database)).toBe("user");
    });
  }, 30_000);

  it("refuses a stranger and admits an invited address once closed", async () => {
    await withMigratedDatabase(async (database) => {
      await mkUserRow(database, { instanceRole: "admin" });
      await setRegistrationDirectly(database, "closed");
      await mkInvite(database, "Invited@example.com");

      expect(await admitSignUp("stranger@example.com", database)).toBeNull();
      // Addresses are compared case-insensitively: mail does not care.
      expect(await admitSignUp("invited@example.com", database)).toBe("user");
    });
  }, 30_000);

  it("treats a stored value the registry rejects as closed", async () => {
    await withMigratedDatabase(async (database) => {
      await mkUserRow(database, { instanceRole: "admin" });
      await setRegistrationDirectly(database, "invite-only");
      await mkInvite(database, "invited@example.com");

      expect(await admitSignUp("stranger@example.com", database)).toBeNull();
      expect(await admitSignUp("invited@example.com", database)).toBe("user");
    });
  }, 30_000);

  it("closes an instance with no registration row behind its first account", async () => {
    await withMigratedDatabase(async (database) => {
      await database
        .delete(instanceSettingValues)
        .where(eq(instanceSettingValues.key, REGISTRATION));

      expect(await admitSignUp("first@example.com", database)).toBe("admin");
      expect(await storedRegistration(database)).toBe("closed");
    });
  }, 30_000);

  describe("under a non-default policy", () => {
    afterEach(() => {
      restoreInstancePolicy();
    });

    it("leaves registration open behind the first account when the instance does not close after it", async () => {
      stubInstancePolicy({ access: { closeAfterFirst: false } });
      await withMigratedDatabase(async (database) => {
        expect(await admitSignUp("first@example.com", database)).toBe("admin");
        expect(await storedRegistration(database)).toBe("open");

        // Better Auth writes the account once admitted; the next sign-up is
        // an ordinary one, still let in by the open registration.
        await mkUserRow(database, {
          email: "first@example.com",
          instanceRole: "admin",
        });
        expect(await admitSignUp("second@example.com", database)).toBe("user");
      });
    }, 30_000);

    it("gives a concurrent pair of first sign-ups exactly one admin, even though registration stays open", async () => {
      stubInstancePolicy({ access: { closeAfterFirst: false } });
      await withMigratedDatabase(async (database) => {
        // Better Auth's insert never runs in this test, so both calls still
        // see an empty users table: the durable claim, not the registration
        // row, is the only thing stopping a second admin.
        const admissions = await Promise.all([
          admitSignUp("one@example.com", database),
          admitSignUp("two@example.com", database),
        ]);

        expect(admissions.filter((role) => role === "admin")).toHaveLength(1);
        expect(admissions.filter((role) => role === "user")).toHaveLength(1);
        expect(await storedRegistration(database)).toBe("open");
      });
    }, 30_000);

    it("admits a stale claim's email to someone else", async () => {
      stubInstancePolicy({ access: { closeAfterFirst: false } });
      await withMigratedDatabase(async (database) => {
        expect(await admitSignUp("first@example.com", database)).toBe("admin");

        // The first sign-up's account never landed, and its claim is well
        // past FIRST_ADMIN_CLAIM_STALE_MS: a fresh sign-up is not locked out.
        await setClaimDirectly(
          database,
          "first@example.com",
          new Date(Date.now() - 11 * 60 * 1000)
        );

        expect(await admitSignUp("second@example.com", database)).toBe("admin");
      });
    }, 30_000);

    it("honours the same email retrying its own still-fresh claim", async () => {
      stubInstancePolicy({ access: { closeAfterFirst: false } });
      await withMigratedDatabase(async (database) => {
        expect(await admitSignUp("first@example.com", database)).toBe("admin");

        // Better Auth's insert failed after admission; the same address
        // trying again still gets to be the admin, not a locked-out stranger.
        expect(await admitSignUp("first@example.com", database)).toBe("admin");
      });
    }, 30_000);

    it("refuses an invited address while closed when invites do not bypass registration", async () => {
      stubInstancePolicy({ access: { invitesBypass: false } });
      await withMigratedDatabase(async (database) => {
        await mkUserRow(database, { instanceRole: "admin" });
        await setRegistrationDirectly(database, "closed");
        await mkInvite(database, "invited@example.com");

        expect(await admitSignUp("invited@example.com", database)).toBeNull();
      });
    }, 30_000);
  });
});

describe("cachedRegistrationMode", () => {
  afterAll(() => setRegistration("open", null));

  it("answers open before anything has read the instance rows", async () => {
    await setRegistration("closed", null);

    expect(cachedRegistrationMode()).toBe("open");
  });

  it("answers what the last read of the instance rows held, until a write drops it", async () => {
    await setRegistration("closed", null);
    await instanceRows();

    expect(cachedRegistrationMode()).toBe("closed");

    await setRegistration("open", null);
    expect(cachedRegistrationMode()).toBe("open");
    await setRegistration("closed", null);
    await instanceRows();
    expect(cachedRegistrationMode()).toBe("closed");
  });

  it("does not cache a read that a write overtook", async () => {
    await setRegistration("closed", null);
    const reading = instanceRows();
    forgetInstanceRows();

    // The read began before the forget, so what it holds may already be
    // stale: it answers its own caller but is not kept for the next one.
    expect((await reading).find((row) => row.key === REGISTRATION)?.value).toBe(
      "closed"
    );
    expect(cachedRegistrationMode()).toBe("open");
  });
});
