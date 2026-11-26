/**
 * How the now-playing view is showing: whether it is over the page, whether it
 * was opened from the dock's cover, and which end of the morph holds the
 * cover's name. One value rather than three flags, because the three only ever
 * move together — a view that is shut has no cover of its own and no memory of
 * how it was opened.
 */
export type NowPlayingState = {
  /** Whether the full view is over the page. */
  open: boolean;
  /** Whether the view was opened from the dock's cover, so the sheet fades in
   *  under the morph instead of sliding the cover's destination off screen. */
  fromCover: boolean;
  /** Which end holds the named cover: the dock's thumb, or the sheet's. */
  coverInSheet: boolean;
};

/** The view shut, with the cover back on the dock. */
export const CLOSED: NowPlayingState = {
  open: false,
  fromCover: false,
  coverInSheet: false,
};

/** Opened outright — from the desktop card, a link, the keyboard — so the
 *  sheet holds the cover from its first frame. */
export const opened = (state: NowPlayingState): NowPlayingState => ({
  ...state,
  open: true,
  coverInSheet: true,
});

/** Opened from the dock's cover: the sheet rises first and the cover stays on
 *  the dock until there is a copy of it in the sheet to fly to. */
export const OPENED_FROM_COVER: NowPlayingState = {
  open: true,
  fromCover: true,
  coverInSheet: false,
};

/** The sheet's own cover is on the page, so the name moves to it. */
export const coverArrived = (state: NowPlayingState): NowPlayingState => ({
  ...state,
  coverInSheet: true,
});
