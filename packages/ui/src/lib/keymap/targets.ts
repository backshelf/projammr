/**
 * A keyboard event's target as the element it almost always is.
 *
 * Recognised by shape rather than by `instanceof`, so the same answer comes
 * back for an element from another realm (an iframe's document has its own
 * `HTMLElement`) and for one synthesised by a test with no DOM at all.
 */
function elementOf(target: EventTarget | null): HTMLElement | null {
  const element = target as HTMLElement | null;
  return element && typeof element.tagName === "string" ? element : null;
}

/** Whether a keyboard event's target is already consuming text input. */
export function isTypingTarget(target: EventTarget | null) {
  const element = elementOf(target);

  if (!element) {
    return false;
  }

  return (
    element.isContentEditable ||
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT"
  );
}

/**
 * Whether the event landed on a control that activates on space or Enter. A
 * keydown targets the focused element, so this asks about that element alone —
 * a `closest` walk would find the surface a control merely sits inside (a
 * dialog carries a role) and mute the key for everything on it.
 *
 * `key` is the combo being pressed, when the caller knows it: Enter on a
 * `gridcell` is the grid's own key (it opens the cell's editor), so the cell
 * does not claim it; space on one still does, as on any other role.
 */
export function isActivationTarget(target: EventTarget | null, key?: string) {
  const element = elementOf(target);

  if (!element) {
    return false;
  }

  const role = element.getAttribute("role");
  return (
    element.tagName === "BUTTON" ||
    element.tagName === "A" ||
    (role !== null && !(role === "gridcell" && key === "Enter"))
  );
}
