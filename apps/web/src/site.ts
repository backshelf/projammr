import { SITE } from "@workspace/ui/lib/site";

/** Facts about the site itself, read by the Astro config, the layouts and the
 * pages. Defined in `@workspace/ui` so the client reads the same values. */
export { SITE };

/** dit's download. `href` is the dmg every release carries, named by the
 * release workflow, behind GitHub's `latest` redirect so the link never
 * carries a version. The build is arm64 only, signed with a self-signed
 * identity and not notarised, so the first open goes through Gatekeeper's
 * right-click › Open. */
export const DIT_DOWNLOAD = {
  label: "Download dit for Mac",
  href: `${SITE.repository}/releases/latest/download/dit-macos-arm64.dmg`,
  requirements: "Apple silicon · macOS 14 or later",
  gatekeeper:
    "It isn't notarised: the first time, right-click the app and choose Open.",
} as const;
