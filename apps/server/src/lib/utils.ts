export type RecursivelyReplaceNullWithUndefined<T> = T extends null
  ? undefined
  : T extends (infer U)[]
    ? RecursivelyReplaceNullWithUndefined<U>[]
    : T extends Record<string, unknown>
      ? { [K in keyof T]: RecursivelyReplaceNullWithUndefined<T[K]> }
      : T;

export function nullsToUndefined<T>(
  obj: T
): RecursivelyReplaceNullWithUndefined<T> {
  if (obj === null || obj === undefined) {
    return undefined as RecursivelyReplaceNullWithUndefined<T>;
  }

  if ((obj as object).constructor.name === "Object" || Array.isArray(obj)) {
    const fields = obj as Record<string, unknown>;
    for (const key in fields) {
      fields[key] = nullsToUndefined(fields[key]);
    }
  }
  return obj as RecursivelyReplaceNullWithUndefined<T>;
}
