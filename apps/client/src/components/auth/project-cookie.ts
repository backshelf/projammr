/**
 * Whether the `currentProject` cookie needs to change to match the route the
 * shell is rendering. The cookie is session state that mirrors the URL; the
 * route is the truth, so this only says yes when the two disagree.
 */
export function shouldUpdateProjectCookie(
  cookieProjectId: number,
  routeProjectId: number
): boolean {
  return cookieProjectId !== routeProjectId;
}
