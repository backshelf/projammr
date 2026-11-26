import { describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { db } from "./index.js";

/**
 * The `CASE … END` expression inside the migration's `USING`, read from the
 * migration file itself so the test exercises exactly what shipped.
 */
const migration = await Bun.file(
  new URL(
    "./migrations/20260917060513_project_description_jsonb/migration.sql",
    import.meta.url
  )
).text();
const CAST_EXPRESSION = sql.raw(
  migration.slice(migration.indexOf("CASE"), migration.lastIndexOf("END") + 3)
);

type Block = {
  id: string;
  type: string;
  content: { type: string; text: string; styles: Record<string, never> }[];
};

describe("project_description_jsonb migration cast", () => {
  it("turns legacy text values into the shapes the block editor expects", async () => {
    const { rows } = await db.execute<{ label: string; migrated: unknown }>(sql`
      WITH sample(label, description) AS (
        VALUES
          ('null', NULL::text),
          ('blank', '   '::text),
          ('json array', '[{"type":"paragraph","content":[]}]'::text),
          ('plain text', 'Some legacy notes'::text)
      )
      SELECT label, ${CAST_EXPRESSION} AS migrated FROM sample
    `);

    const byLabel = Object.fromEntries(rows.map((r) => [r.label, r.migrated]));

    expect(byLabel["null"]).toBeNull();
    expect(byLabel["blank"]).toBeNull();
    expect(byLabel["json array"]).toEqual([{ type: "paragraph", content: [] }]);

    const paragraph = byLabel["plain text"] as Block[];
    expect(paragraph).toHaveLength(1);
    expect(paragraph[0]?.type).toBe("paragraph");
    expect(paragraph[0]?.content).toEqual([
      { type: "text", text: "Some legacy notes", styles: {} },
    ]);
    expect(typeof paragraph[0]?.id).toBe("string");
    expect(paragraph[0]?.id.length).toBeGreaterThan(0);
  });
});
