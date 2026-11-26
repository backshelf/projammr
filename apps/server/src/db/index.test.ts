import { describe, expect, it } from "bun:test";
import { db } from "./index.js";

describe("db", () => {
  it("plans each foreign-key check against the referenced table as it stands", async () => {
    const client = await db.$client.connect();
    // This transaction's own scans of the parent, before they are flushed to
    // the cumulative statistics.
    const parentScans = async () => {
      const { rows } = await client.query<{ seq: number; idx: number }>(
        `select seq_scan::int as seq, idx_scan::int as idx
           from pg_stat_xact_all_tables
          where relid = 'fk_parent'::regclass`
      );
      return rows[0]!;
    };

    try {
      await client.query("begin");
      await client.query(
        "create temp table fk_parent (hash text primary key) on commit drop"
      );
      await client.query(
        `create temp table fk_child (id int, hash text not null references fk_parent)
           on commit drop`
      );
      // A parent of one page, analysed as such, checked often enough for the
      // connection to cache the check's plan: a sequential scan.
      await client.query(
        "insert into fk_parent select md5(i::text) from generate_series(1, 20) i"
      );
      await client.query("analyze fk_parent");
      for (let i = 1; i <= 10; i++) {
        await client.query("insert into fk_child values ($1, md5($2))", [
          i,
          String(i),
        ]);
      }

      // The parent grows a hundredfold with no analyse in between, as
      // `objects` does when a push lands.
      await client.query(
        "insert into fk_parent select md5('grown-' || i) from generate_series(1, 20000) i"
      );
      const before = await parentScans();
      await client.query(
        "insert into fk_child select i, md5('grown-' || i) from generate_series(1, 1000) i"
      );
      const after = await parentScans();

      expect(after.seq - before.seq).toBe(0);
      expect(after.idx - before.idx).toBe(1000);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
