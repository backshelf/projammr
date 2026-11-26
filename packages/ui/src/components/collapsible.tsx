"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { IconChevronRight } from "@tabler/icons-react";
import { AnimatePresence, FADE, m, SPRING } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

/**
 * Base UI's Root keeps the resolved open value internal, so `CollapsibleContent`
 * mirrors it here to drive its own mount and the height it animates to.
 */
const CollapsibleOpenContext = React.createContext<boolean | null>(null);

function useCollapsibleOpen(component: string) {
  const open = React.use(CollapsibleOpenContext);
  if (open === null)
    throw new Error(`${component} must sit inside Collapsible`);
  return open;
}

function Collapsible({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  children,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      open={open}
      onOpenChange={(next, details) => {
        setUncontrolled(next);
        onOpenChange?.(next, details);
      }}
      {...props}
    >
      <CollapsibleOpenContext value={open}>{children}</CollapsibleOpenContext>
    </CollapsiblePrimitive.Root>
  );
}

/** The trigger carries the named group `CollapsibleChevron` reads its state
 *  from. It is the group rather than the root because collapsibles nest — a
 *  collection inside the sidebar's Collections group — and a group on the root
 *  would leave every nested chevron reading the outermost open ancestor. No
 *  trigger is an ancestor of another, so each caret answers its own section. */
function CollapsibleTrigger({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn("group/collapsible-trigger", className)}
      {...props}
    />
  );
}

/**
 * The panel. Motion owns the height animation on the small surface a section
 * folds into; Base UI's own CSS-transition detection has nothing to see, so
 * the panel stays internally `keepMounted` and `hidden` is always overridden
 * — the React tree, not Base UI's bookkeeping, decides when it actually
 * leaves the DOM. `inert` while closed keeps it out of the tab order and the
 * accessibility tree without the `display:none` that would cut the animation
 * short.
 */
function CollapsibleContent({
  className,
  keepMounted,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Panel> & {
  /** Keeps the panel in the DOM, collapsed to zero height, instead of
   *  unmounting it — for content holding state a remount would lose. */
  keepMounted?: boolean;
}) {
  const open = useCollapsibleOpen("CollapsibleContent");
  return (
    <AnimatePresence initial={false}>
      {(open || keepMounted) && (
        <CollapsiblePrimitive.Panel
          key="collapsible-panel"
          data-slot="collapsible-content"
          keepMounted
          hidden={false}
          inert={!open}
          render={
            <m.div
              initial={{ height: 0, opacity: 0 }}
              animate={
                open
                  ? { height: "auto", opacity: 1 }
                  : { height: 0, opacity: 0 }
              }
              exit={{ height: 0, opacity: 0 }}
              transition={{ height: SPRING.surface, opacity: FADE.quick }}
              style={{ overflow: "hidden" }}
            />
          }
          className={className}
          {...props}
        />
      )}
    </AnimatePresence>
  );
}

/**
 * The disclosure caret: points right while closed and turns down when the
 * enclosing section opens, driven by the trigger's own state so no caller
 * tracks it for the caret. A `CollapsibleTrigger` publishes `data-panel-open`;
 * a plain button that discloses something — a row card's children — joins the
 * `collapsible-trigger` group and publishes `aria-expanded` instead.
 */
function CollapsibleChevron({
  className,
  ...props
}: React.ComponentProps<typeof IconChevronRight>) {
  return (
    <IconChevronRight
      data-slot="collapsible-chevron"
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 text-ink-faint motion-move",
        "group-aria-expanded/collapsible-trigger:rotate-90 group-data-panel-open/collapsible-trigger:rotate-90",
        className
      )}
      {...props}
    />
  );
}

export {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  CollapsibleChevron,
};
