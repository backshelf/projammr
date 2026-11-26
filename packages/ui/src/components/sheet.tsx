"use client";

import { Drawer as SheetPrimitive } from "@base-ui/react/drawer";
import { IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import {
  AnimatePresence,
  FADE,
  LEAVE,
  m,
  OPTICAL,
  SPRING,
  useReducedMotion,
  type Variants,
} from "@workspace/ui/lib/motion";
import { useModalScope } from "@workspace/ui/lib/modal-scope";
import { composeRender } from "@workspace/ui/lib/overlay";
import {
  OverlayPresenceContext,
  PRESENT,
  useOverlayOpen,
  useOverlayPresence,
} from "@workspace/ui/lib/overlay-presence";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

type AsChild = { asChild?: boolean };

type SheetSide = "top" | "right" | "bottom" | "left";

/** The swipe that dismisses a sheet is the one that takes it back to its edge. */
const SWIPE_DIRECTION = {
  top: "up",
  right: "right",
  bottom: "down",
  left: "left",
} as const satisfies Record<
  SheetSide,
  SheetPrimitive.Root.Props["swipeDirection"]
>;

/**
 * What the Root needs from the content: which edge the sheet sits on (the
 * swipe direction follows it) and whether a press outside dismisses it.
 */
type SheetPlacement = { side: SheetSide; dismissOnOutside: boolean };

type SheetContextValue = {
  place: (placement: SheetPlacement) => void;
  /** Whether the last close was a swipe, for an exit that has less to do. */
  closedBySwipe: () => boolean;
};

const SheetContext = React.createContext<SheetContextValue | null>(null);

function useSheet(component: string) {
  const sheet = React.use(SheetContext);
  if (!sheet) throw new Error(`${component} must sit inside its Sheet`);
  return sheet;
}

function Sheet({
  children,
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  ...props
}: Omit<
  SheetPrimitive.Root.Props,
  "children" | "actionsRef" | "swipeDirection" | "disablePointerDismissal"
> & {
  children?: React.ReactNode;
}) {
  const [placement, setPlacement] = React.useState<SheetPlacement>({
    side: "right",
    dismissOnOutside: true,
  });
  const swipedRef = React.useRef(false);

  const handleOpenChange = React.useCallback(
    (next: boolean, details: SheetPrimitive.Root.ChangeEventDetails) => {
      onOpenChange?.(next, details);
      if (!details.isCanceled) {
        swipedRef.current = !next && details.reason === "swipe";
      }
    },
    [onOpenChange]
  );

  const { rootProps, presence } = useOverlayOpen<
    SheetPrimitive.Root.ChangeEventDetails,
    SheetPrimitive.Root.Actions
  >({
    open,
    defaultOpen,
    onOpenChange: handleOpenChange,
    onOpenChangeComplete,
  });

  // A sheet opened without an event (a controlled `open`) starts afresh: a
  // swipe that closed it last time says nothing about how it closes now.
  React.useLayoutEffect(() => {
    if (presence.open) swipedRef.current = false;
  }, [presence.open]);

  const sheet = React.useMemo<SheetContextValue>(
    () => ({ place: setPlacement, closedBySwipe: () => swipedRef.current }),
    []
  );

  return (
    <SheetPrimitive.Root
      {...props}
      {...rootProps}
      swipeDirection={SWIPE_DIRECTION[placement.side]}
      disablePointerDismissal={!placement.dismissOnOutside}
    >
      <SheetContext value={sheet}>
        <OverlayPresenceContext value={presence}>
          {children}
        </OverlayPresenceContext>
      </SheetContext>
    </SheetPrimitive.Root>
  );
}

function SheetTrigger(props: SheetPrimitive.Trigger.Props & AsChild) {
  return (
    <SheetPrimitive.Trigger
      data-slot="sheet-trigger"
      {...composeRender(props)}
    />
  );
}

function SheetClose(props: SheetPrimitive.Close.Props & AsChild) {
  return (
    <SheetPrimitive.Close data-slot="sheet-close" {...composeRender(props)} />
  );
}

/**
 * The scrim, unselectable — as is the content above it. A sheet opened from a
 * long press arrives under a finger that is still down, and WebKit's selection
 * recogniser fires half a second in against whatever lies beneath it, taking
 * its anchor from the page behind the scrim. Sheet bodies are buttons and
 * labels, so nothing is lost by refusing selection there as well.
 */
function SheetOverlay({ className }: { className?: string }) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      render={
        <m.div
          {...PRESENT}
          variants={OPTICAL}
          initial="hidden"
          animate="shown"
          exit="leaving"
        />
      }
      className={cn(
        "fixed inset-0 z-50 bg-black/80 select-none [-webkit-touch-callout:none] supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
    />
  );
}

/**
 * The mark that says a bottom sheet swipes to dismiss. A mark, not a control:
 * the primitive's swipe already covers the whole panel, so the grabber itself
 * takes no pointer handling of its own.
 */
function SheetGrabber() {
  return (
    <div
      aria-hidden
      className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-rule-strong"
    />
  );
}

/**
 * Home-indicator clearance, as an `::after` spacer rather than bottom padding.
 * Padding cannot survive the trip: consumers pass a shorthand (`p-0`, `py-2`)
 * that tailwind-merge treats as overriding `pb`, and any inset that did win
 * would swallow the padding the consumer asked for. The spacer is a flex item
 * no padding class can address, so the clearance and the consumer's own
 * padding add up.
 */
const EDGE_SPACER =
  "after:block after:h-[env(safe-area-inset-bottom)] after:shrink-0";

/**
 * Where a sheet sits. Chosen in JS rather than written as `data-[side=…]:`
 * utilities so `cn` can see them as ordinary classes: a variant-prefixed
 * utility is a different utility to tailwind-merge, so a consumer's `w-full`
 * would lose to the prefixed `w-3/4` on specificity.
 *
 * Every side but `top` reaches the bottom of the viewport — a bottom sheet by
 * placement, a left or right sheet by running the full height — so each one
 * clears the home indicator with EDGE_SPACER.
 */
const SIDE_CLASSES: Record<SheetSide, string> = {
  top: "inset-x-0 top-0 h-auto border-b",
  bottom: `inset-x-0 bottom-0 h-auto border-t ${EDGE_SPACER}`,
  left: `inset-y-0 left-0 h-full w-3/4 border-r ${EDGE_SPACER} sm:max-w-sm`,
  right: `inset-y-0 right-0 h-full w-3/4 border-l ${EDGE_SPACER} sm:max-w-sm`,
};

/**
 * Once a swipe has dismissed the sheet, the rest of the travel is the
 * primitive's, run at the speed the finger released it.
 */
const SWIPE_AWAY: Record<SheetSide, string> = {
  top: "data-swipe-dismiss:[transform:translateY(-100%)]",
  bottom: "data-swipe-dismiss:[transform:translateY(100%)]",
  left: "data-swipe-dismiss:[transform:translateX(-100%)]",
  right: "data-swipe-dismiss:[transform:translateX(100%)]",
};

/**
 * The panel. Two properties move it and each has one owner. `transform`
 * belongs to the swipe: the primitive writes it inline while a finger drags
 * and publishes the offset as `--drawer-swipe-movement-*` on this element, and
 * the transition carries a released sheet back to rest or, once dismissed, off
 * its edge. `translate` belongs to Motion, for the entrance and the exit. The
 * two compose, so neither overwrites the other.
 */
const PANEL =
  "fixed z-50 flex flex-col bg-popover bg-clip-padding text-xs/relaxed text-popover-foreground shadow-overlay outline-none select-none [-webkit-touch-callout:none] [transform:translate(var(--drawer-swipe-movement-x,0px),var(--drawer-swipe-movement-y,0px))] transition-[transform] duration-(--dur-settle) ease-arrive data-swipe-dismiss:duration-[calc(var(--dur-settle)*var(--drawer-swipe-strength,1))] data-swiping:transition-none";

/** Where a sheet waits off its edge, as a `translate` of its own size. */
const OFFSTAGE: Record<SheetSide, string> = {
  top: "0% -100%",
  bottom: "0% 100%",
  left: "-100% 0%",
  right: "100% 0%",
};
const ONSTAGE = "0% 0%";

/**
 * How a sheet arrives. `slide` travels in from its edge; `fade` has no travel,
 * for a sheet opened while something else is already carrying its content
 * into place.
 */
type SheetEntrance = "slide" | "fade";

/**
 * A sheet slides in from its edge on the drawer spring and leaves the way it
 * came. A sheet a swipe dismissed is already on its way out, so its exit only
 * fades what is left. Under reduced motion neither way travels: Motion's own
 * setting stops transforms, and `translate` is not one.
 */
function sheetVariants(
  side: SheetSide,
  entrance: SheetEntrance,
  still: boolean
): Variants {
  const travels = !still && entrance === "slide";
  return {
    hidden: travels
      ? { translate: OFFSTAGE[side], opacity: 1 }
      : { translate: ONSTAGE, opacity: 0 },
    shown: {
      translate: ONSTAGE,
      opacity: 1,
      transition: { translate: SPRING.drawer, opacity: FADE.move },
    },
    leaving: (swiped?: boolean) =>
      swiped || still
        ? { opacity: 0, transition: LEAVE.quick }
        : {
            translate: OFFSTAGE[side],
            opacity: 1,
            transition: { translate: LEAVE.settle },
          },
  };
}

/**
 * Calls `onClosed` once the sheet's parts have left the tree. It renders
 * inside the popup, so its cleanup runs in the commit that removes the popup,
 * which is the commit in which the primitive releases the scroll lock and
 * queues focus back to where it was. Focus lands on a microtask after that
 * commit, so the callback waits a frame. A cleanup while the sheet is still
 * open (the whole sheet unmounting, a development double-invoke) is not a
 * close.
 */
function ClosedSignal({ onClosed }: { onClosed?: () => void }) {
  const { open } = useOverlayPresence("SheetContent");
  const latestRef = React.useRef({ open, onClosed });
  React.useEffect(() => {
    latestRef.current = { open, onClosed };
  });
  React.useEffect(() => {
    const current = latestRef;
    return () => {
      const { open: stillOpen, onClosed: closed } = current.current;
      if (stillOpen || !closed) return;
      requestAnimationFrame(() => closed());
    };
  }, []);
  return null;
}

function SheetContent({
  className,
  overlayClassName,
  children,
  side = "right",
  showCloseButton = true,
  onClosed,
  dismissOnOutside = true,
  swipe = true,
  entrance = "slide",
  modalScope = true,
  ...props
}: Omit<SheetPrimitive.Popup.Props, "className" | "render"> & {
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
  side?: SheetSide;
  showCloseButton?: boolean;
  /**
   * Overrides the scrim. A sheet that sits beside content the user is still
   * reading wants a lighter one than the default dim.
   */
  overlayClassName?: string;
  /**
   * Runs once, after the sheet has closed and gone: its exit finished, focus
   * returned, the page interactive again. An action that opens an overlay of
   * its own waits for this so two modal layers never overlap.
   */
  onClosed?: () => void;
  /** Whether a press outside the sheet dismisses it. */
  dismissOnOutside?: boolean;
  /** Whether a swipe towards the sheet's edge dismisses it. */
  swipe?: boolean;
  entrance?: SheetEntrance;
  /**
   * Set false to skip pushing the modal command scope. A sheet that sits
   * beside content the user keeps working in (the table's peek panel) opts
   * out, so the page's keys stay live under it.
   */
  modalScope?: boolean;
}) {
  const { place, closedBySwipe } = useSheet("SheetContent");
  const { open, onExitComplete } = useOverlayPresence("SheetContent");
  const still = useReducedMotion() ?? false;
  useModalScope(modalScope && open);

  React.useLayoutEffect(() => {
    place({ side, dismissOnOutside });
  }, [place, side, dismissOnOutside]);

  return (
    <AnimatePresence custom={closedBySwipe()} onExitComplete={onExitComplete}>
      {open && (
        <SheetPrimitive.Portal
          key="sheet-portal"
          keepMounted
          data-slot="sheet-portal"
        >
          <SheetOverlay className={overlayClassName} />
          <SheetPrimitive.Viewport data-slot="sheet-viewport" {...PRESENT}>
            <SheetPrimitive.Popup
              data-slot="sheet-content"
              data-side={side}
              data-base-ui-swipe-ignore={swipe ? undefined : ""}
              render={
                <m.div
                  {...PRESENT}
                  variants={sheetVariants(side, entrance, still)}
                  initial="hidden"
                  animate="shown"
                  exit="leaving"
                />
              }
              className={cn(
                PANEL,
                SWIPE_AWAY[side],
                SIDE_CLASSES[side],
                className
              )}
              {...props}
            >
              {side === "bottom" && swipe && <SheetGrabber />}
              <ClosedSignal onClosed={onClosed} />
              <SheetPrimitive.Content
                data-slot="sheet-body"
                className="contents"
              >
                {children}
              </SheetPrimitive.Content>
              {showCloseButton && (
                <SheetPrimitive.Close
                  data-slot="sheet-close"
                  render={
                    <Button
                      variant="ghost"
                      className="absolute top-4 right-4"
                      size="icon-sm"
                    />
                  }
                >
                  <IconX />
                  <span className="sr-only">Close</span>
                </SheetPrimitive.Close>
              )}
            </SheetPrimitive.Popup>
          </SheetPrimitive.Viewport>
        </SheetPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-6", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-6", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: Omit<SheetPrimitive.Title.Props, "className"> & { className?: string }) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-sm font-medium text-foreground",
        className
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: Omit<SheetPrimitive.Description.Props, "className"> & {
  className?: string;
}) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-xs/relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SIDE_CLASSES,
  EDGE_SPACER,
};
export type { SheetEntrance, SheetSide };
