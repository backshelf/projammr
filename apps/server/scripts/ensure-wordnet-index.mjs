/**
 * wordpos reads WordNet through fast-index files that its own postinstall
 * writes into wordnet-db's dict directory. Bun only runs the lifecycle
 * scripts of packages it trusts, so that postinstall never runs and
 * `new WordPOS()` throws ENOENT. This runs the same tool whenever the files
 * are missing — after every install here, and in the image's runtime
 * dependency stage.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const parts = ["adv", "adj", "verb", "noun"];
const { path: dict } = require("wordnet-db");

if (parts.every((part) => existsSync(join(dict, `fast-index.${part}.json`)))) {
  process.exit(0);
}

const wordpos = dirname(require.resolve("wordpos/package.json"));
execFileSync(
  process.execPath,
  [
    join(wordpos, "tools/stat.js"),
    "--no-stats",
    ...parts.map((part) => `index.${part}`),
  ],
  { cwd: wordpos, stdio: "inherit" }
);
