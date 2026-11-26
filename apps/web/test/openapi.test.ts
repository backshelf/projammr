import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { buildSiteSpecs, serialise, SPEC_FILES } from "../scripts/openapi";

describe("the API reference's committed specs", () => {
  it("match the server's own", async () => {
    const specs = await buildSiteSpecs();
    for (const [name, file] of Object.entries(SPEC_FILES)) {
      const committed = (
        await Bun.file(join(import.meta.dir, "..", file)).text()
      ).replaceAll("\r\n", "\n");
      expect(
        committed,
        `${file} is stale: run \`bun run typegen\` in apps/web`
      ).toBe(serialise(specs[name as keyof typeof SPEC_FILES]));
    }
  });
});
