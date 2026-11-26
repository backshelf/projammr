import { defineConfig, devices } from "@playwright/test";
import { OWNER_STATE } from "./tests/fixtures";

/** The first sign-up: the `setup` project's one spec, which no other project runs. */
const SIGN_UP_SPEC = /sign-up\.spec\.ts$/;

/**
 * The browser suite runs against the stack `src/stack.ts` brings up, and it
 * needs that stack to be fresh: the first sign-up makes the instance admin and
 * closes registration behind it, so the `setup` project (which signs the owner
 * up through the UI) fails on an instance that already has accounts. Bring the
 * stack down and up again before every run.
 *
 * `setup` saves the owner's session; every other project depends on it and
 * starts signed in.
 */
export default defineConfig({
  testDir: "./tests",
  // The specs share one instance and build on the owner's account, so they run
  // one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "https://localhost",
    // The stack's certificate comes from a CA generated per stack. The smoke
    // proves the TLS path with verification on; the browser does not repeat it.
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: SIGN_UP_SPEC },
    {
      name: "chromium",
      testIgnore: SIGN_UP_SPEC,
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: OWNER_STATE },
    },
  ],
});
