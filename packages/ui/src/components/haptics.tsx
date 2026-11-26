"use client";

import {
  createContext,
  useCallback,
  use,
  useEffect,
  type ReactNode,
} from "react";
import { useHaptic } from "use-haptic";

/**
 * Everything a finger presses that does not already ring for itself. The menu
 * items, tabs, options and slider thumbs below answer through their own
 * primitives, so they are taken back out again — a Radix tab is a
 * `<button role="tab">` and would otherwise match both.
 */
const PRESSABLE = 'button, a[href], summary, [role="button"]';
const RINGS_FOR_ITSELF =
  '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"],' +
  ' [role="option"], [role="tab"], [role="slider"]';
const INERT = "[disabled], [aria-disabled='true'], [data-disabled]";

/**
 * How long a buzz lasts, where the platform lets us say. Only Android hears
 * it: iOS is buzzed by toggling a switch control, which has one sensation and
 * no duration to set.
 */
const HAPTIC_MS = 200;

/** A buzz is a phone affordance: a device driven by a cursor has no motor to
 *  answer with, and asking one to vibrate is noise in the log at best. */
const onTouchDevice = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(pointer: coarse)").matches === true;

const HapticsContext = createContext<() => void>(() => {});

/**
 * The app's haptics, as one buzz every surface shares.
 *
 * `use-haptic` appends a hidden switch control at a fixed element id and
 * toggles it — the only way to reach the vibration motor from iOS Safari,
 * which implements no Vibration API — so it is called once, here, rather than
 * per component. Everything else reaches it through `useHaptics`.
 *
 * The provider also carries the press haptic for the whole app, as one
 * delegated listener. Not a prop on `Button`: that component has no
 * `"use client"` of its own, so a Server Component rendering one would have
 * to serialise a handler across the boundary, which React refuses. Delegation
 * also reaches the buttons this package never rendered — a bare `<button>` in
 * a page, an anchor styled as one — which is what "every press" has to mean.
 *
 * Capture phase, because a control that stops propagation still deserves the
 * answer, and `pointerdown` rather than `click`, because a haptic belongs to
 * the finger landing.
 *
 * `enabled` is the viewer's own say: off, nothing buzzes, neither a press nor
 * a `useHaptics` call.
 */
export function HapticsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const { triggerHaptic } = useHaptic(HAPTIC_MS);

  const haptic = useCallback(() => {
    if (enabled && onTouchDevice()) triggerHaptic();
  }, [enabled, triggerHaptic]);

  useEffect(() => {
    if (!enabled) return;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      if (!(event.target instanceof Element)) return;

      const pressed = event.target.closest(PRESSABLE);
      if (!pressed) return;
      if (pressed.matches(RINGS_FOR_ITSELF)) return;
      if (pressed.closest(INERT)) return;

      haptic();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [enabled, haptic]);

  return <HapticsContext value={haptic}>{children}</HapticsContext>;
}

/**
 * Buzz the device, if it has a motor and the viewer is using a finger. There
 * is one sensation: iOS offers no way to ask for another, so a vocabulary of
 * intensities would be one the app could only keep on Android.
 *
 * Safe to call unconditionally — outside the provider it does nothing.
 */
export function useHaptics(): () => void {
  return use(HapticsContext);
}
