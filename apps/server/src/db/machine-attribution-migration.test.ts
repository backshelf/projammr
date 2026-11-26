import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import type { Pool } from "pg";
import { migrateUpTo, withThrowawayDatabase } from "../test/database.js";
import { MIGRATIONS_FOLDER } from "./migrator.js";

/**
 * The migration that gives the rows dit pushed before machines were recorded on
 * them the machine they came from, where the data tells one machine from
 * another. Run here as it runs on a live database: migrated to just before it,
 * given rows, then its own statements applied.
 */
const MIGRATION = "20261022001743_machine_attribution";

/** The statements the migration ships, run in order on the connection. */
async function runMigration(pool: Pool): Promise<void> {
  const sql = await Bun.file(
    join(MIGRATIONS_FOLDER, MIGRATION, "migration.sql")
  ).text();
  for (const statement of sql.split("--> statement-breakpoint")) {
    if (statement.trim()) await pool.query(statement);
  }
}

const one = async <T extends Record<string, unknown>>(
  pool: Pool,
  text: string,
  values: unknown[] = []
) => (await pool.query<T>(text, values)).rows[0]!;

const T0 = Date.UTC(2026, 5, 1);
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

describe("the machine attribution migration", () => {
  it("attributes the rows one machine can be told apart for and nulls the rest", async () => {
    await withThrowawayDatabase(async (pool) => {
      await migrateUpTo(pool, MIGRATION);

      const user = async (name: string) =>
        (
          await one<{ id: string }>(
            pool,
            "insert into users (id, name, email) values ($1, $1, $2) returning id",
            [name, `${name}@example.com`]
          )
        ).id;
      const ana = await user("ana");
      const ben = await user("ben");

      const machine = async (id: string, userId: string, name: string) =>
        pool.query(
          "insert into machines (id, user_id, name, platform, app_version, last_seen_at) values ($1, $2, $3, 'macOS', '0.14.0', now())",
          [id, userId, name]
        );
      // Two collaborators each have a "MacBook Pro": the name alone cannot say
      // whose a row is, the author can.
      await machine("machine-ana-macbook", ana, "MacBook Pro");
      await machine("machine-ben-macbook", ben, "MacBook Pro");

      const { id: projectId } = await one<{ id: number }>(
        pool,
        "insert into projects (name) values ('Attribution') returning id"
      );
      const { id: priorityId } = await one<{ id: number }>(
        pool,
        "insert into priority_levels (project_id, name, colour, rank, is_default) values ($1, 'None', '#6C7278', 0, true) returning id",
        [projectId]
      );

      /** A repo with one dit set on one branch, and its ids. */
      const repoWithSet = async (name: string, lastPushed: boolean) => {
        const { id: repoId } = await one<{ id: number }>(
          pool,
          "insert into repos (project_id, name, last_push_at) values ($1, $2, $3) returning id",
          [projectId, name, lastPushed ? at(0) : null]
        );
        const { id: sessionId } = await one<{ id: number }>(
          pool,
          "insert into sessions (name, daw, project_id, priority_id) values ($1, 'manual', $2, $3) returning id",
          [name, projectId, priorityId]
        );
        const { id: branchId } = await one<{ id: number }>(
          pool,
          "insert into branches (session_id, name) values ($1, 'main') returning id",
          [sessionId]
        );
        return { repoId, sessionId, branchId };
      };

      const save = async (
        set: { sessionId: number; branchId: number },
        minutes: number,
        machineName: string | null,
        source = "dit"
      ) =>
        (
          await one<{ id: number }>(
            pool,
            "insert into saves (session_id, project_id, branch_id, file_updated_at, source, machine_name) values ($1, $2, $3, $4, $5, $6) returning id",
            [
              set.sessionId,
              projectId,
              set.branchId,
              at(minutes),
              source,
              machineName,
            ]
          )
        ).id;

      let commitNumber = 0;
      const commit = async (
        set: { repoId: number; sessionId: number; branchId: number },
        saveId: number,
        authorId: string,
        machineName: string | null
      ) => {
        commitNumber += 1;
        return (
          await one<{ id: number }>(
            pool,
            "insert into commits (repo_id, session_id, branch_id, hash, save_id, message, author_id, machine_name, kind, committed_at) values ($1, $2, $3, $4, $5, 'm', $6, $7, 'user', now()) returning id",
            [
              set.repoId,
              set.sessionId,
              set.branchId,
              `hash-${commitNumber}`,
              saveId,
              authorId,
              machineName,
            ]
          )
        ).id;
      };

      const segment = async (
        set: { sessionId: number; branchId: number },
        machineName: string,
        minutes: number
      ) =>
        (
          await one<{ id: number }>(
            pool,
            "insert into time_segments (session_id, branch_id, machine_name, started_at, ended_at, source) values ($1, $2, $3, $4, $5, 'script') returning id",
            [
              set.sessionId,
              set.branchId,
              machineName,
              at(minutes),
              at(minutes + 1),
            ]
          )
        ).id;

      // One set both collaborators pushed to, in time order: Ana's commit, then
      // Ben's. Each commit covers the saves up to its own.
      const shared = await repoWithSet("Shared set", true);
      const anaEarlier = await save(shared, 1, "MacBook Pro");
      const anaOwn = await save(shared, 2, "MacBook Pro");
      const benBetween = await save(shared, 3, "MacBook Pro");
      const benOwn = await save(shared, 4, "MacBook Pro");
      const namedAnother = await save(shared, 5, "Studio");
      const benLastOwn = await save(shared, 6, "MacBook Pro");
      const uncommitted = await save(shared, 7, "MacBook Pro");
      const scannerSave = await save(shared, 8, "MacBook Pro", "scan");
      await commit(shared, anaOwn, ana, "MacBook Pro");
      await commit(shared, benOwn, ben, "MacBook Pro");
      await commit(shared, benLastOwn, ben, "MacBook Pro");
      // Ana's rename: a commit naming a machine she no longer has.
      const renamedCommit = await commit(shared, namedAnother, ana, "Old name");
      const sharedSpans = [
        await segment(shared, "MacBook Pro", 10),
        await segment(shared, "Old name", 20),
      ];

      // A set only Ana pushed to: its spans are hers.
      const solo = await repoWithSet("Solo set", true);
      const soloSave = await save(solo, 1, "MacBook Pro");
      await commit(solo, soloSave, ana, "MacBook Pro");
      const soloSpans = [
        await segment(solo, "MacBook Pro", 10),
        await segment(solo, "Somebody else's Mac", 20),
      ];

      // A repo never pushed to keeps no last machine.
      const idle = await repoWithSet("Idle set", false);
      const idleSave = await save(idle, 1, "MacBook Pro");
      await commit(idle, idleSave, ana, "MacBook Pro");

      await runMigration(pool);

      const machineOf = async (table: string, id: number) =>
        (
          await one<{ machine: string | null }>(
            pool,
            `select ${table === "repos" ? "last_push_machine_id" : "machine_id"} as machine from ${table} where id = $1`,
            [id]
          )
        ).machine;

      // A commit takes the machine of its author that carries its name.
      expect(
        (
          await pool.query<{ machine_id: string | null; author_id: string }>(
            "select machine_id, author_id from commits where repo_id = $1 order by id",
            [shared.repoId]
          )
        ).rows
      ).toEqual([
        { machine_id: "machine-ana-macbook", author_id: ana },
        { machine_id: "machine-ben-macbook", author_id: ben },
        { machine_id: "machine-ben-macbook", author_id: ben },
        { machine_id: null, author_id: ana },
      ]);
      expect(await machineOf("commits", renamedCommit)).toBeNull();

      // A save takes the machine of the commit covering it, when that commit
      // names the same machine: Ben's commit covers the save between the two.
      expect(await machineOf("saves", anaEarlier)).toBe("machine-ana-macbook");
      expect(await machineOf("saves", anaOwn)).toBe("machine-ana-macbook");
      expect(await machineOf("saves", benBetween)).toBe("machine-ben-macbook");
      expect(await machineOf("saves", benOwn)).toBe("machine-ben-macbook");
      expect(await machineOf("saves", benLastOwn)).toBe("machine-ben-macbook");
      // It names another machine than the commit covering it, is not covered
      // by any commit, or is the scanner's: no machine.
      expect(await machineOf("saves", namedAnother)).toBeNull();
      expect(await machineOf("saves", uncommitted)).toBeNull();
      expect(await machineOf("saves", scannerSave)).toBeNull();
      expect(await machineOf("saves", idleSave)).toBe("machine-ana-macbook");

      // A span is attributed only where every commit of its session naming
      // that machine is one author's and attributed: the shared set's
      // "MacBook Pro" is two people's, and an "Old name" matches no machine.
      expect(await machineOf("time_segments", sharedSpans[0]!)).toBeNull();
      expect(await machineOf("time_segments", sharedSpans[1]!)).toBeNull();
      expect(await machineOf("time_segments", soloSpans[0]!)).toBe(
        "machine-ana-macbook"
      );
      expect(await machineOf("time_segments", soloSpans[1]!)).toBeNull();

      // A repo's last push takes the machine of its newest commit; one never
      // pushed to, or whose newest commit has none, keeps none.
      expect(await machineOf("repos", solo.repoId)).toBe("machine-ana-macbook");
      expect(await machineOf("repos", idle.repoId)).toBeNull();
      expect(await machineOf("repos", shared.repoId)).toBeNull();
    });
  }, 60_000);
});
