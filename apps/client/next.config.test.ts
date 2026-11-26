import { describe, expect, it } from "bun:test";
import nextConfig from "./next.config";
import { THEME_SCRIPT } from "./src/lib/theme/script";

async function sitePolicy() {
  const rules = (await nextConfig.headers?.()) ?? [];
  const site = rules.find((rule) => rule.source === "/:path*");
  return site?.headers.find(
    (header) => header.key === "Content-Security-Policy-Report-Only"
  )?.value;
}

describe("next.config headers", () => {
  it("allows the theme script by the sha256 hash of its exact text", async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(THEME_SCRIPT)
    );
    const hash = Buffer.from(digest).toString("base64");

    const scriptSrc = (await sitePolicy())
      ?.split("; ")
      .find((directive) => directive.startsWith("script-src "));
    expect(scriptSrc).toBe(
      `script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}'`
    );
  });
});
