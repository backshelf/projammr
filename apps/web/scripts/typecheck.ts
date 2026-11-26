#!/usr/bin/env bun
// Type-checks the site with `tsc` and `@astrojs/ts-content-mapper`, the mapper
// that lets TypeScript 7.1 read `.astro` files (`bun run typecheck`).
//
// The mapper hands tsc every `.astro` file in the program, Astro's and
// Starlight's own components in `node_modules` included, and those are not
// declaration files, so `skipLibCheck` does not cover them. Their diagnostics
// are the library's, not ours: this applies `skipLibCheck`'s rule to them,
// counting them on one line and failing only on a diagnostic in this package's
// own files.

const tsc = Bun.spawnSync(
  ["tsc", "--noEmit", "--runExternalCode", "--pretty", "false"],
  { cwd: import.meta.dir + "/..", stdout: "pipe", stderr: "pipe" }
);
const output = tsc.stdout.toString() + tsc.stderr.toString();

/** A diagnostic starts at a line naming its file (`path(line,col): error …`);
 * the indented lines after it belong to it. */
const diagnostics: string[] = [];
for (const line of output.split("\n")) {
  if (/^\S.*\(\d+,\d+\): /.test(line) || diagnostics.length === 0) {
    if (line.trim()) diagnostics.push(line);
  } else if (line.trim()) {
    diagnostics[diagnostics.length - 1] += "\n" + line;
  }
}

const isLibrary = (d: string) => d.split("(")[0]!.includes("node_modules/");
const own = diagnostics.filter((d) => !isLibrary(d));
const library = diagnostics.length - own.length;

if (own.length > 0) console.log(own.join("\n"));
if (library > 0) {
  console.log(
    `${library} diagnostic(s) inside node_modules skipped, as skipLibCheck would.`
  );
}
process.exit(
  own.length > 0 || (tsc.exitCode !== 0 && diagnostics.length === 0) ? 1 : 0
);
