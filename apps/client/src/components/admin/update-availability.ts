/** What the About pane's update line shows, derived from the instance's own
 *  `updateCheck` flag and the release tag fetched in the browser. `checked:
 *  false` means the instance turned the check off — the pane renders nothing
 *  about updates, and nothing is fetched to produce this value either. */
export type UpdateAvailability =
  | { checked: false }
  | { checked: true; available: false }
  | { checked: true; available: true; latest: string };

const withoutV = (tag: string) => tag.replace(/^v/, "");

export function updateAvailability(
  updateCheck: boolean,
  version: string,
  latestTag: string | null
): UpdateAvailability {
  if (!updateCheck) return { checked: false };
  if (latestTag == null || withoutV(latestTag) === withoutV(version)) {
    return { checked: true, available: false };
  }
  return { checked: true, available: true, latest: latestTag };
}
