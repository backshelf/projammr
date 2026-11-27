import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8")) as {
  entry: string;
};
const production = process.argv.includes("--production");

const FONTS_DIR = path.resolve("../../packages/ui/src/styles/fonts");

function fontDataUrl(filename: string): string {
  const bytes = fs.readFileSync(path.join(FONTS_DIR, filename));
  return `data:font/woff2;base64,${bytes.toString("base64")}`;
}

const projammrFontsPlugin: esbuild.Plugin = {
  name: "projammr-fonts",
  setup(build) {
    build.onResolve({ filter: /^@projammr\/fonts$/ }, () => ({
      path: "projammr-fonts",
      namespace: "projammr-fonts",
    }));
    build.onLoad(
      { filter: /.*/, namespace: "projammr-fonts" },
      () => ({
        contents: `
          export const redaction35 = ${JSON.stringify(fontDataUrl("Redaction35.woff2"))};
          export const departureMono = ${JSON.stringify(fontDataUrl("DepartureMono-Regular.woff2"))};
          export const splineSansMono = ${JSON.stringify(fontDataUrl("SplineSansMono.woff2"))};
          export const splineSansMono500 = ${JSON.stringify(fontDataUrl("SplineSansMono-500.woff2"))};
        `,
        loader: "js",
      })
    );
  },
};

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  plugins: [projammrFontsPlugin],
});
