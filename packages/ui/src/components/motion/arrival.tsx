"use client";

import { useHydrated } from "@workspace/ui/hooks/use-hydrated";
import {
  FADE,
  m,
  useReducedMotion,
  type Variants,
} from "@workspace/ui/lib/motion";
import {
  createContext,
  use,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";

/** A first load plays the authored entrance; a client navigation is a cut. */
export type ArrivalKind = "load" | "nav";

type Arrival = {
  kind: ArrivalKind;
  /** True once the entrance has finished; late-mounting parts render at rest. */
  settled: boolean;
};

const ArrivalContext = createContext<Arrival>({ kind: "nav", settled: true });

/**
 * Which arrival a mount is. The hydration pass is the server's render being
 * adopted, so a subtree whose first client render happens before hydration is
 * a first load; one that mounts after it is a client navigation.
 */
export function arrivalKind(hydratedAtMount: boolean): ArrivalKind {
  return hydratedAtMount ? "nav" : "load";
}

/** {@link arrivalKind} for the mount this hook runs in. */
export function useArrivalKind(): ArrivalKind {
  const hydrated = useHydrated();
  const [hydratedAtMount] = useState(hydrated);
  return arrivalKind(hydratedAtMount);
}

/**
 * The page's arrival root: the scroll container of an entity page, or the
 * header of a page with no entity behind it. It holds `animate="shown"` for
 * the whole subtree, so every {@link useArrival} part picks its state up
 * through Motion's context instead of a prop threaded through the server
 * components in between.
 *
 * While the entrance runs the element carries `data-arrival`, which is what
 * scopes the status pie sweep in globals.css to a first load.
 */
export function ArrivalRoot({
  kind,
  as = "div",
  ref,
  className,
  style,
  children,
}: {
  kind: ArrivalKind;
  /** The tag the root renders: a page's scroll container is a `div`, the head
   *  of a page with no entity behind it is a `header`. */
  as?: "div" | "header";
  ref?: Ref<HTMLElement>;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const reduced = useReducedMotion() ?? false;
  const [settled, setSettled] = useState(false);
  const isSettled = settled || reduced;
  const hiddenAtRef = useRef<number | null>(null);
  const Root = as === "header" ? m.header : m.div;

  // Effects inside React 19 <Activity> tear down when `mode="hidden"` and
  // re-run when `mode="visible"`. Settling on reveal (outside synchronous
  // StrictMode double-invoke) and arming a duration-bounded fallback ensures
  // children never stall at `opacity: 0` if WAAPI was canceled or skipped.
  useEffect(() => {
    if (isSettled) return;
    if (hiddenAtRef.current !== null && Date.now() - hiddenAtRef.current > 20) {
      setSettled(true);
      return;
    }
    const fallbackMs = kind === "load" ? 1200 : 350;
    const timer = window.setTimeout(() => setSettled(true), fallbackMs);
    return () => {
      window.clearTimeout(timer);
      hiddenAtRef.current = Date.now();
    };
  }, [isSettled, kind]);

  return (
    <ArrivalContext value={{ kind, settled: isSettled }}>
      <Root
        ref={ref as Ref<HTMLDivElement & HTMLElement>}
        className={className}
        style={style}
        data-arrival={isSettled ? undefined : kind}
        initial={isSettled ? false : "hidden"}
        animate={isSettled ? "settled" : "shown"}
        onAnimationComplete={() => setSettled(true)}
      >
        {children}
      </Root>
    </ArrivalContext>
  );
}

/** The parts of the entrance, in the order they come forward. `delay` is the
 *  first-load stagger; a navigation ignores it and only crossfades. */
export const ARRIVAL = {
  art: { delay: 0, dur: 1.1, motion: "bloom" },
  wash: { delay: 0, dur: 1.1, motion: "fade" },
  crumbs: { delay: 0.1, dur: 0.5, motion: "rise" },
  eyebrow: { delay: 0.18, dur: 0.5, motion: "rise" },
  title: { delay: 0.24, dur: 0.62, motion: "rise" },
  byline: { delay: 0.34, dur: 0.5, motion: "rise" },
  audio: { delay: 0.42, dur: 0.5, motion: "rise" },
  rail: { delay: 0.3, dur: 0.5, motion: "fade" },
} as const;

/** A part of the page entrance. */
export type ArrivalPart = keyof typeof ARRIVAL;

type ArrivalMotion = (typeof ARRIVAL)[ArrivalPart]["motion"];

/**
 * How each kind of part comes forward: `from` is where the first load starts
 * it, `rest` the values it holds afterwards. `rest` is repeated in every
 * state so a part that only crossfades — a navigation, a late remount — still
 * renders at the scale or offset its resting look depends on.
 *
 * The rail fades without rising: it is a sticky element, and a transform on
 * it would compete with its own sticky offset.
 */
const ENTRANCE = {
  bloom: { from: { opacity: 0, scale: 1.08 }, rest: { scale: 1.15 } },
  rise: { from: { opacity: 0, y: 12 }, rest: { y: 0 } },
  fade: { from: { opacity: 0 }, rest: {} },
} as const satisfies Record<ArrivalMotion, { from: object; rest: object }>;

/** How one part travels under each kind of arrival: the load plays the
 *  stagger its spec describes, a navigation only crossfades. */
export function arrivalVariants(
  kind: ArrivalKind,
  part: ArrivalPart
): Variants {
  const spec = ARRIVAL[part];
  const { from, rest } = ENTRANCE[spec.motion];

  return kind === "load"
    ? {
        hidden: from,
        shown: {
          opacity: 1,
          ...rest,
          transition: {
            duration: spec.dur,
            delay: spec.delay,
            ease: FADE.arrive.ease,
          },
        },
        settled: {
          opacity: 1,
          ...rest,
          transition: FADE.quick,
        },
      }
    : {
        hidden: { ...rest, opacity: 0 },
        shown: { ...rest, opacity: 1, transition: FADE.move },
        settled: { ...rest, opacity: 1, transition: FADE.quick },
      };
}

/**
 * Whether the page entrance has finished. A part that binds motion values of
 * its own — the scroll-driven masthead — waits for this before it does, so
 * the entrance and the second writer never hold the same property at once.
 */
export function useArrivalSettled(): boolean {
  return use(ArrivalContext).settled;
}

/**
 * The props one part of the entrance spreads onto its `m.*` element. While
 * the entrance runs the part sets no `initial` of its own: a variant label
 * there would make it control its own variants, and Motion would stop it
 * inheriting the root's `animate`, so it would render hidden and never come
 * forward. It inherits `hidden` → `shown` from {@link ArrivalRoot} instead.
 * Once the entrance has settled `initial` is `false` and `animate` resolves to
 * `settled`, so a remounting part appears in place and an interrupted
 * animation (such as a React `<Activity>` hide/reveal) never stalls hidden.
 */
export function useArrival(part: ArrivalPart): {
  initial: false | undefined;
  animate: "settled" | undefined;
  variants: Variants;
} {
  const { kind, settled } = use(ArrivalContext);
  return {
    initial: settled ? false : undefined,
    animate: settled ? "settled" : undefined,
    variants: arrivalVariants(kind, part),
  };
}
