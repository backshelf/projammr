import {
  useAppearance,
  type AppearanceValue,
} from "@workspace/ui/lib/appearance";
import {
  useReducedMotion as useSystemReducedMotion,
  type Transition,
  type Variants,
} from "motion/react";

// `motion/react-m` exports one component per tag (`div`, `span`, …), not a
// combined `m` object — the namespace re-export is what makes `m.div` work.
export * as m from "motion/react-m";
export {
  AnimatePresence,
  LayoutGroup,
  useMotionValue,
  useMotionTemplate,
  useSpring,
  useTransform,
  useScroll,
  useInView,
  inView,
  useDragControls,
  animate,
  type MotionProps,
  type MotionValue,
  type MotionStyle,
  type Transition,
  type Variants,
} from "motion/react";

/** What each `data-motion` value makes of the OS preference. */
const REDUCED_MOTION: Record<
  AppearanceValue<"motion">,
  (system: boolean | null) => boolean | null
> = {
  system: (system) => system,
  reduce: () => true,
  full: () => false,
};

/**
 * Whether motion should be reduced: the OS preference, unless `data-motion`
 * on `<html>` overrides it. The same switch the `motion-reduce` variant
 * follows in CSS and `MotionProvider` hands to Motion, so a script and a
 * stylesheet never disagree. Null on the server with no override, as Motion's
 * own hook is.
 */
export function useReducedMotion(): boolean | null {
  const system = useSystemReducedMotion();
  return REDUCED_MOTION[useAppearance("motion")](system);
}

/** Arrival curve: fast out of the gate, long settle. The same curve `--ease-arrive` carries in CSS. */
export const EASE_ARRIVE = [0.2, 0, 0, 1] as const;
/** Leave curve: gathers speed and is gone. `--ease-leave` in CSS. */
export const EASE_LEAVE = [0.3, 0, 0.8, 0.15] as const;

/**
 * The springs. Every one is overdamped or critically damped — the room's
 * controls settle like gear, they do not bounce. `visualDuration` is the time
 * the motion appears to take; the tail is inaudible.
 */
export const SPRING = {
  /** A press or a hover: the control answers before the finger lifts. */
  press: { type: "spring", visualDuration: 0.12, bounce: 0 },
  /** A toggle, a chip, a menu popping: firm and short. */
  control: { type: "spring", visualDuration: 0.22, bounce: 0 },
  /** A surface taking its place: a dialog, a revealed section, a bulk bar. */
  surface: { type: "spring", visualDuration: 0.38, bounce: 0 },
  /** A drawer travelling the height of the screen. */
  drawer: { type: "spring", visualDuration: 0.42, bounce: 0 },
} as const satisfies Record<string, Transition>;

/** Optical timings — durations, not springs, because light has no mass. */
export const FADE = {
  quick: { duration: 0.14, ease: EASE_ARRIVE },
  move: { duration: 0.24, ease: EASE_ARRIVE },
  settle: { duration: 0.42, ease: EASE_ARRIVE },
  arrive: { duration: 0.7, ease: EASE_ARRIVE },
} as const satisfies Record<string, Transition>;

export const LEAVE = {
  quick: { duration: 0.1, ease: EASE_LEAVE },
  move: { duration: 0.16, ease: EASE_LEAVE },
  settle: { duration: 0.26, ease: EASE_LEAVE },
} as const satisfies Record<string, Transition>;

/**
 * Optical surface variants. A surface fades up out of the wash and comes to
 * focus (a whisper of scale); it leaves faster and smaller.
 */
export const SURFACE: Variants = {
  hidden: { opacity: 0, scale: 0.98 },
  shown: {
    opacity: 1,
    scale: 1,
    transition: { opacity: FADE.move, scale: SPRING.surface },
  },
  leaving: { opacity: 0, scale: 0.99, transition: LEAVE.move },
};

/** A menu or popover pops from its anchor: the same shape, tighter. */
export const POP: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  shown: {
    opacity: 1,
    scale: 1,
    transition: { opacity: FADE.quick, scale: SPRING.control },
  },
  leaving: { opacity: 0, scale: 0.98, transition: LEAVE.quick },
};

/** Something that only changes its light. */
export const OPTICAL: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: FADE.move },
  leaving: { opacity: 0, transition: LEAVE.move },
};
