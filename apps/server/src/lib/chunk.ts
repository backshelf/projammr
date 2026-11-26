/**
 * Postgres's per-statement bind-parameter limit (a `uint16` count in the wire
 * protocol). A bulk query that turns a whole `all: true` selection into an
 * `inArray` filter or a flattened `INSERT` can pass it, so it chunks its ids
 * to stay under {@link bindParamLimit}.
 */
const MAX_BIND_PARAMS = 65_535;
let limit = MAX_BIND_PARAMS;

/** The bind-parameter budget a chunked statement sizes itself against. */
export function bindParamLimit(): number {
  return limit;
}

/**
 * Test-only: lowers the bind-parameter limit so a chunk boundary can be
 * crossed with a handful of rows instead of tens of thousands. `undefined`
 * restores the real Postgres limit.
 */
export function setBindParamLimitForTest(value: number | undefined): void {
  limit = value ?? MAX_BIND_PARAMS;
}

/**
 * Splits `items` into groups of at most `size`, preserving order. A bulk
 * query that binds one parameter per id (or more) needs this to stay under
 * Postgres's per-statement bind-parameter limit once a selection is large.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new RangeError("chunk size must be positive");

  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
