import { stubGlobal } from "@workspace/test/globals";
import { DARK_SCHEME_QUERY } from "./script";

/**
 * Stands in for `matchMedia` with an OS colour scheme a test can flip; the
 * test DOM has no `matchMedia` of its own. Only `DARK_SCHEME_QUERY` is
 * answered, so a lookup of any other query fails the test.
 */
export function stubColorScheme(initiallyDark: boolean) {
  let dark = initiallyDark;
  const listeners = new Set<() => void>();
  stubGlobal("matchMedia", (query: string) => {
    if (query !== DARK_SCHEME_QUERY) {
      throw new Error(`Unexpected media query ${query}`);
    }
    return {
      get matches() {
        return dark;
      },
      addEventListener: (_type: "change", listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_type: "change", listener: () => void) =>
        listeners.delete(listener),
    };
  });
  return {
    setDark(next: boolean) {
      dark = next;
      for (const listener of listeners) listener();
    },
  };
}
