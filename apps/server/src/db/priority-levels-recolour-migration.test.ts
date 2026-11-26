import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";
import {
  migrateUpTo,
  withMigratedDatabase,
  withThrowawayDatabase,
} from "../test/database.js";
import { MIGRATIONS_FOLDER } from "./migrator.js";
import {
  DEFAULT_PRIORITY_LEVELS,
  seedPriorityLevels,
} from "./queries/priority-levels.js";
import { priorityLevels } from "./schema/priority-levels.js";
import { projects } from "./schema/projects.js";

/**
 * The migration that recolours a project's seeded-but-untouched priority
 * levels to the new ramp. Run here on a database of its own,
 * migrated to just before it, given one project whose scale mixes untouched
 * levels with an edited one, then migrated the rest of the way.
 */
const RECOLOUR = "20260927223610_priority-levels-recolour";

const OLD_SEED = {
  None: "#525252",
  Low: "#898989",
  Medium: "#525252",
  High: "#020202",
  Urgent: "#020202",
} as const;

async function seedScale(
  pool: Pool,
  name: string,
  levels: readonly {
    name: string;
    colour: string;
    rank: number;
    isDefault?: boolean;
  }[]
): Promise<number> {
  const {
    rows: [project],
  } = await pool.query<{ id: number }>(
    "insert into projects (name) values ($1) returning id",
    [name]
  );
  const projectId = project!.id;
  for (const level of levels) {
    await pool.query(
      "insert into priority_levels (project_id, name, colour, rank, is_default) values ($1, $2, $3, $4, $5)",
      [
        projectId,
        level.name,
        level.colour,
        level.rank,
        level.isDefault ?? false,
      ]
    );
  }
  return projectId;
}

describe("the priority-levels-recolour migration", () => {
  it("recolours a level only when its name and colour still match the old seed at its rank", async () => {
    await withThrowawayDatabase(async (pool) => {
      await migrateUpTo(pool, RECOLOUR);

      const untouched = await seedScale(pool, "Untouched", [
        { name: "None", colour: OLD_SEED.None, rank: 0, isDefault: true },
        { name: "Low", colour: OLD_SEED.Low, rank: 1 },
        { name: "Medium", colour: OLD_SEED.Medium, rank: 2 },
        { name: "High", colour: OLD_SEED.High, rank: 3 },
        { name: "Urgent", colour: OLD_SEED.Urgent, rank: 4 },
      ]);
      const edited = await seedScale(pool, "Edited", [
        { name: "None", colour: OLD_SEED.None, rank: 0, isDefault: true },
        { name: "Low", colour: OLD_SEED.Low, rank: 1 },
        // Renamed from Medium; the old Medium colour is kept, but the name no
        // longer matches, so this must be left alone.
        { name: "Backlog", colour: OLD_SEED.Medium, rank: 2 },
        // Recoloured by its editor; the name still matches High, but the
        // colour no longer does, so this must be left alone too.
        { name: "High", colour: "#3355ff", rank: 3 },
        { name: "Urgent", colour: OLD_SEED.Urgent, rank: 4 },
      ]);

      await migrate(drizzle({ client: pool }), {
        migrationsFolder: MIGRATIONS_FOLDER,
      });

      const { rows } = await pool.query<{
        project_id: number;
        name: string;
        colour: string;
      }>(
        "select project_id, name, colour from priority_levels order by project_id, rank"
      );
      const scaleOf = (projectId: number) =>
        rows
          .filter((row) => row.project_id === projectId)
          .map(({ name, colour }) => ({ name, colour }));

      expect(scaleOf(untouched)).toEqual(
        DEFAULT_PRIORITY_LEVELS.map(({ name, colour }) => ({ name, colour }))
      );

      expect(scaleOf(edited)).toEqual([
        { name: "None", colour: "#6C7278" },
        { name: "Low", colour: "#0891C9" },
        { name: "Backlog", colour: OLD_SEED.Medium },
        { name: "High", colour: "#3355ff" },
        { name: "Urgent", colour: "#D0183A" },
      ]);
    }, "priority_recolour");
  }, 60_000);

  it("gives a new project the new ramp", async () => {
    await withMigratedDatabase(async (database) => {
      const [project] = await database
        .insert(projects)
        .values({ name: "Fresh" })
        .returning();
      const projectId = project!.id;

      await seedPriorityLevels(database, projectId);

      const levels = await database
        .select({
          name: priorityLevels.name,
          colour: priorityLevels.colour,
          rank: priorityLevels.rank,
          isDefault: priorityLevels.isDefault,
        })
        .from(priorityLevels)
        .where(eq(priorityLevels.projectId, projectId));

      expect(
        levels
          .sort((a, b) => a.rank - b.rank)
          .map(({ name, colour, isDefault }) => ({ name, colour, isDefault }))
      ).toEqual(
        DEFAULT_PRIORITY_LEVELS.map(({ name, colour, isDefault }) => ({
          name,
          colour,
          isDefault,
        }))
      );
    }, "priority_recolour_seed");
  }, 60_000);
});
