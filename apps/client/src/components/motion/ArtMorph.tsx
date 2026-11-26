import { STEP_NEXT, STEP_PREV } from "@/components/motion/morph-keys";
import { ViewTransition, type ReactElement } from "react";

/**
 * The masthead's art field, under a name every masthead shares, which is what
 * a running-order step cross-fades on. The inner frame clips the art to the
 * field.
 */
export function MastheadArtMorph({ children }: { children: ReactElement }) {
  return (
    <ViewTransition
      name="masthead-art"
      share={{
        [STEP_NEXT]: "art-step",
        [STEP_PREV]: "art-step",
        default: "none",
      }}
      default="none"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 h-(--masthead-band)">
        <div className="absolute inset-0 overflow-hidden">{children}</div>
      </div>
    </ViewTransition>
  );
}

/**
 * The masthead's own boundary. It exists for stacking: a named group paints
 * above the page, so without one the art flying in would cover the title for
 * the length of the morph. Between two mastheads it holds still
 * (`.hold`), except on a running-order step, where it slides the way
 * the step went.
 */
export function MastheadMorph({ children }: { children: ReactElement }) {
  return (
    <ViewTransition
      name="masthead"
      share={{
        [STEP_NEXT]: "masthead-next",
        [STEP_PREV]: "masthead-prev",
        default: "hold",
      }}
      enter="hold"
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

/**
 * The rail's boundary, for the same stacking reason as {@link MastheadMorph}:
 * it holds the glass column above the art in flight. `update` covers a
 * running-order step, where the rail stays mounted and only its content
 * changes.
 */
export function RailMorph({ children }: { children: ReactElement }) {
  return (
    <ViewTransition
      name="rail"
      share="hold"
      enter="hold"
      update="hold"
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
