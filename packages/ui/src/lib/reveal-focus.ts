/**
 * Where focus goes when a section opens its editing UI on request. The
 * content can name the region that should take focus with
 * {@link REVEAL_FOCUS}; otherwise the first focusable control in it does.
 */

/** Marks the region inside a section that takes focus when the section is
 *  revealed — an editor whose editable surface mounts after the section does,
 *  rather than the chevron or menu that happens to come first. Spread it on
 *  the region's element. */
export const REVEAL_FOCUS = { "data-reveal-focus": "" } as const;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"]):not([type="file"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * The element to focus inside `root`: the first focusable control inside the
 * {@link REVEAL_FOCUS} region when there is one — `null` while that region has
 * not mounted anything focusable yet — or else the first focusable control
 * in `root`.
 */
export function revealFocusTarget(root: Element): HTMLElement | null {
  const region = root.querySelector("[data-reveal-focus]");
  return (region ?? root).querySelector<HTMLElement>(FOCUSABLE);
}

/** Whether `root` names a region that should take focus. */
export const hasRevealFocusRegion = (root: Element): boolean =>
  root.querySelector("[data-reveal-focus]") !== null;
