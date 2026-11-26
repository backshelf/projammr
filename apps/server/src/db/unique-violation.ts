const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/**
 * Drizzle wraps the driver's error in one of its own, so the SQLSTATE sits a
 * `cause` link or two below the error a query throws.
 */
function hasSqlState(
  error: unknown,
  state: string,
  constraint?: string,
  depth = 4
): boolean {
  if (depth < 0 || typeof error !== "object" || error === null) return false;
  const {
    code,
    constraint: violated,
    cause,
  } = error as {
    code?: unknown;
    constraint?: unknown;
    cause?: unknown;
  };
  if (code === state && (constraint === undefined || violated === constraint)) {
    return true;
  }
  return hasSqlState(cause, state, constraint, depth - 1);
}

/**
 * Postgres reports a unique-constraint collision as SQLSTATE 23505. With
 * `constraint`, only a collision on that constraint counts.
 */
export function isUniqueViolation(
  error: unknown,
  constraint?: string
): boolean {
  return hasSqlState(error, UNIQUE_VIOLATION, constraint);
}

/**
 * Postgres reports an insert naming a row that is not there (or no longer is)
 * as SQLSTATE 23503. With `constraint`, only a violation of that foreign key
 * counts.
 */
export function isForeignKeyViolation(
  error: unknown,
  constraint?: string
): boolean {
  return hasSqlState(error, FOREIGN_KEY_VIOLATION, constraint);
}
