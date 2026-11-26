/**
 * Builds a stand-in for a full row from only the fields the code under test
 * reads.
 *
 * API row types carry every column, so a focused unit test would otherwise
 * either spell out twenty irrelevant fields or cast through `unknown`, which
 * checks nothing and rots silently when the row's shape changes. `Partial<T>`
 * keeps every field that *is* given checked against the real type, so a renamed
 * or retyped column still fails the test's type-check.
 *
 * Shallow by design: nest a `partial` call for a nested object rather than
 * widening the whole tree.
 */
export function partial<T>(value: Partial<T>): T {
  return value as T;
}
