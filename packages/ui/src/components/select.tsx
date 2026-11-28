"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconSelector,
} from "@tabler/icons-react";

import { useHaptics } from "@workspace/ui/components/haptics";
import { AnimatePresence, m, POP } from "@workspace/ui/lib/motion";
import {
  OverlayPresenceContext,
  PRESENT,
  useOverlayOpen,
  useOverlayPresence,
} from "@workspace/ui/lib/overlay-presence";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

/**
 * A single, non-clearable select never actually produces a `null` value — no
 * item carries one and there is no clear affordance — so `onValueChange`
 * stays typed at plain `string`, the contract every caller already expects.
 */
function Select({
  children,
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  onValueChange,
  ...props
}: Omit<
  SelectPrimitive.Root.Props<string, false>,
  "children" | "actionsRef" | "onValueChange"
> & {
  children?: React.ReactNode;
  onValueChange?: (
    value: string,
    eventDetails: SelectPrimitive.Root.ChangeEventDetails
  ) => void;
}) {
  const haptic = useHaptics();
  const { rootProps, presence } = useOverlayOpen<
    SelectPrimitive.Root.OpenChangeEventDetails,
    SelectPrimitive.Root.Actions
  >({ open, defaultOpen, onOpenChange, onOpenChangeComplete });
  return (
    <SelectPrimitive.Root
      {...props}
      {...rootProps}
      onValueChange={(value, eventDetails) => {
        haptic();
        onValueChange?.(value ?? "", eventDetails);
      }}
    >
      <OverlayPresenceContext value={presence}>
        {children}
      </OverlayPresenceContext>
    </SelectPrimitive.Root>
  );
}

function SelectGroup({
  className,
  ...props
}: SelectPrimitive.Group.Props & { className?: string }) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  );
}

function SelectValue({ ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  className?: string;
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-md border border-input bg-input/20 px-2 py-1.5 text-base/relaxed whitespace-nowrap motion-ink outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-7 data-[size=sm]:h-6 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 md:text-xs/relaxed dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 coarse:h-auto coarse:min-h-11 coarse:text-base [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon data-slot="select-icon">
        <IconSelector className="pointer-events-none size-3.5 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

/**
 * The popup. `alignItemWithTrigger` (Base UI's Positioner default) overlaps
 * the popup on the trigger so the selected item's text lands under the
 * trigger's value text for a mouse pick — no separate "popper" placement mode
 * to switch on.
 */
function SelectContent({
  className,
  align = "center",
  side,
  sideOffset,
  alignOffset,
  collisionPadding,
  children,
  ...props
}: Omit<SelectPrimitive.Popup.Props, "className" | "render"> &
  Pick<
    SelectPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "collisionPadding"
  > & { className?: string }) {
  const { open, onExitComplete } = useOverlayPresence("SelectContent");
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <SelectPrimitive.Portal key="select-portal">
          <SelectPrimitive.Positioner
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            collisionPadding={collisionPadding}
            className="z-50"
          >
            <SelectPrimitive.Popup
              data-slot="select-content"
              render={
                <m.div
                  {...PRESENT}
                  variants={POP}
                  initial="hidden"
                  animate="shown"
                  exit="leaving"
                  style={{ transformOrigin: "var(--transform-origin)" }}
                />
              }
              className={cn(
                "relative min-w-32 overflow-hidden rounded-lg bg-popover/70 text-popover-foreground shadow-menu ring-1 ring-foreground/10 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! **:data-[variant=destructive]:**:text-accent-foreground! **:data-[variant=destructive]:text-accent-foreground! **:data-[variant=destructive]:focus:bg-foreground/10!",
                className
              )}
              {...props}
            >
              <SelectScrollUpButton />
              <SelectPrimitive.List
                data-slot="select-list"
                className="max-h-(--available-height) overflow-x-hidden overflow-y-auto"
              >
                {children}
              </SelectPrimitive.List>
              <SelectScrollDownButton />
            </SelectPrimitive.Popup>
          </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
      )}
    </AnimatePresence>
  );
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props & { className?: string }) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props & { className?: string }) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex min-h-7 w-full cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs/relaxed outline-hidden motion-ink select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 coarse:min-h-11 coarse:text-base [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <IconCheck className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props & { className?: string }) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn(
        "pointer-events-none -mx-1 my-1 h-px bg-border/50",
        className
      )}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: SelectPrimitive.ScrollUpArrow.Props & { className?: string }) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <IconChevronUp />
    </SelectPrimitive.ScrollUpArrow>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: SelectPrimitive.ScrollDownArrow.Props & { className?: string }) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...props}
    >
      <IconChevronDown />
    </SelectPrimitive.ScrollDownArrow>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
