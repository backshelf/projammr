import { ViewTransition, type ReactElement } from "react";

/**
 * Names the playing cover for the view transition between the mini-player and
 * the now-playing sheet, so the thumb in the dock grows into the sheet's cover
 * and shrinks back into the dock when the sheet closes. `.cover-morph` in
 * globals.css.
 *
 * Exactly one end is `active` at a time — the dock's while the sheet is shut,
 * the sheet's while it is open — since two mounted boundaries with one name
 * make the browser skip the transition. Toggling `active` unmounts one
 * boundary and mounts the other in the same commit, which is what pairs them.
 */
export function CoverMorph({
  active,
  children,
}: {
  active: boolean;
  children: ReactElement;
}) {
  return active ? (
    <ViewTransition name="now-playing-cover" share="cover-morph" default="none">
      {children}
    </ViewTransition>
  ) : (
    children
  );
}
