"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { IconCheck, IconChevronRight } from "@tabler/icons-react";

import { useHaptics } from "@workspace/ui/components/haptics";
import { AnimatePresence, m, POP } from "@workspace/ui/lib/motion";
import { composeRender, MENU_LABEL } from "@workspace/ui/lib/overlay";
import {
  OverlayPresenceContext,
  PRESENT,
  useOverlayOpen,
  useOverlayPresence,
} from "@workspace/ui/lib/overlay-presence";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

/* Every selectable row keeps its dense 28px mark under a cursor and takes a
   44px floor under a finger (`coarse:min-h-11`), the same floor Button's
   sizes carry — a menu is often the only way to reach an action on a phone. */

type AsChild = { asChild?: boolean };

const MENU_POPUP =
  "relative z-50 overflow-hidden rounded-lg border border-rule-strong bg-popover/80 p-1 text-popover-foreground shadow-menu before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150 **:data-[slot$=-item]:focus:bg-foreground/10 **:data-[slot$=-item]:data-highlighted:bg-foreground/10 **:data-[slot$=-separator]:bg-foreground/5 **:data-[slot$=-trigger]:focus:bg-foreground/10 **:data-[slot$=-trigger]:aria-expanded:bg-foreground/10! **:data-[variant=destructive]:**:text-accent-foreground! **:data-[variant=destructive]:text-accent-foreground! **:data-[variant=destructive]:focus:bg-foreground/10!";

const MENU_ITEM =
  "group/dropdown-menu-item motion-ink relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs/relaxed outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground not-data-[variant=destructive]:data-highlighted:**:text-accent-foreground data-inset:pl-7.5 data-[variant=destructive]:text-destructive data-highlighted:data-[variant=destructive]:bg-destructive/10 data-highlighted:data-[variant=destructive]:text-destructive dark:data-highlighted:data-[variant=destructive]:bg-destructive/20 data-disabled:pointer-events-none data-disabled:opacity-50 coarse:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 data-[variant=destructive]:*:[svg]:text-destructive";

const MENU_TOGGLE_ITEM =
  "motion-ink relative flex min-h-7 cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-xs outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-highlighted:**:text-accent-foreground data-inset:pl-7.5 data-disabled:pointer-events-none data-disabled:opacity-50 coarse:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

/**
 * Radix's `onSelect` closed the menu unless the handler called
 * `event.preventDefault()`. Base UI items take `onClick` and close via
 * `closeOnClick`; this hands `onSelect` the click's `nativeEvent` (a real DOM
 * `Event`, so a caller's `preventDefault()` compiles and works unchanged) and
 * calls `event.preventBaseUIHandler()` when it was prevented, which stops the
 * item's own `closeOnClick` handler the same way `AlertDialogClose` stops the
 * alert dialog's. Keyboard activation (Enter/Space) dispatches the same click,
 * so it is covered without separate handling.
 */
function useSelectableItem<
  E extends { nativeEvent: Event; preventBaseUIHandler: () => void },
>(
  onClick: ((event: E) => void) | undefined,
  onSelect: ((event: Event) => void) | undefined
) {
  const haptic = useHaptics();
  return React.useCallback(
    (event: E) => {
      haptic();
      onClick?.(event);
      onSelect?.(event.nativeEvent);
      if (event.nativeEvent.defaultPrevented) event.preventBaseUIHandler();
    },
    [haptic, onClick, onSelect]
  );
}

function DropdownMenu({
  children,
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  ...props
}: Omit<MenuPrimitive.Root.Props, "children" | "actionsRef"> & {
  children?: React.ReactNode;
}) {
  const { rootProps, presence } = useOverlayOpen<
    MenuPrimitive.Root.ChangeEventDetails,
    MenuPrimitive.Root.Actions
  >({ open, defaultOpen, onOpenChange, onOpenChangeComplete });
  return (
    <MenuPrimitive.Root {...props} {...rootProps}>
      <OverlayPresenceContext value={presence}>
        {children}
      </OverlayPresenceContext>
    </MenuPrimitive.Root>
  );
}

function DropdownMenuPortal(props: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props & AsChild) {
  return (
    <MenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      {...composeRender(props)}
    />
  );
}

function DropdownMenuContent({
  className,
  align = "start",
  side,
  sideOffset = 4,
  alignOffset,
  collisionPadding,
  ...props
}: Omit<MenuPrimitive.Popup.Props, "className" | "render"> &
  Pick<
    MenuPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "collisionPadding"
  > & { className?: string }) {
  const { open, onExitComplete } = useOverlayPresence("DropdownMenuContent");
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <DropdownMenuPortal key="dropdown-menu-portal" keepMounted>
          <MenuPrimitive.Positioner
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            collisionPadding={collisionPadding}
            className="z-50"
          >
            <MenuPrimitive.Popup
              data-slot="dropdown-menu-content"
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
                MENU_POPUP,
                "max-h-(--available-height) w-(--anchor-width) min-w-32 overflow-x-hidden overflow-y-auto",
                className
              )}
              {...props}
            />
          </MenuPrimitive.Positioner>
        </DropdownMenuPortal>
      )}
    </AnimatePresence>
  );
}

function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

/**
 * Base UI's `Menu.GroupLabel` throws outside a `Menu.Group` ancestor; some
 * callers head a menu with a label that has no group around it, so this stays
 * a plain styled heading rather than that part.
 */
function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn(MENU_LABEL, "px-2 py-1.5 data-inset:pl-7.5", className)}
      {...props}
    />
  );
}

function DropdownMenuItem({
  className,
  onClick,
  onSelect,
  inset,
  variant = "default",
  ...props
}: Omit<MenuPrimitive.Item.Props, "onSelect" | "onClick"> &
  AsChild & {
    onClick?: MenuPrimitive.Item.Props["onClick"];
    onSelect?: (event: Event) => void;
    inset?: boolean;
    variant?: "default" | "destructive";
  }) {
  const handleClick = useSelectableItem(onClick, onSelect);
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      onClick={handleClick}
      className={cn(MENU_ITEM, className)}
      {...composeRender(props)}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  onClick,
  onSelect,
  children,
  checked,
  inset,
  closeOnClick = true,
  ...props
}: Omit<MenuPrimitive.CheckboxItem.Props, "onSelect" | "onClick"> & {
  onClick?: MenuPrimitive.CheckboxItem.Props["onClick"];
  onSelect?: (event: Event) => void;
  inset?: boolean;
}) {
  const handleClick = useSelectableItem(onClick, onSelect);
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      onClick={handleClick}
      closeOnClick={closeOnClick}
      className={cn(MENU_TOGGLE_ITEM, className)}
      checked={checked}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-checkbox-item-indicator"
      >
        <MenuPrimitive.CheckboxItemIndicator>
          <IconCheck />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return (
    <MenuPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  );
}

function DropdownMenuRadioItem({
  className,
  onClick,
  onSelect,
  children,
  inset,
  closeOnClick = true,
  ...props
}: Omit<MenuPrimitive.RadioItem.Props, "onSelect" | "onClick"> & {
  onClick?: MenuPrimitive.RadioItem.Props["onClick"];
  onSelect?: (event: Event) => void;
  inset?: boolean;
}) {
  const handleClick = useSelectableItem(onClick, onSelect);
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      onClick={handleClick}
      closeOnClick={closeOnClick}
      className={cn(MENU_TOGGLE_ITEM, className)}
      {...props}
    >
      <span
        className="pointer-events-none absolute right-2 flex items-center justify-center"
        data-slot="dropdown-menu-radio-item-indicator"
      >
        <MenuPrimitive.RadioItemIndicator>
          <IconCheck />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border/50", className)}
      {...props}
    />
  );
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-micro tracking-widest text-muted-foreground group-data-highlighted/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  );
}

/** A submenu is its own presence scope: it opens and exits independently of
 *  the menu that hosts it. */
function DropdownMenuSub({
  children,
  open,
  defaultOpen,
  onOpenChange,
  onOpenChangeComplete,
  ...props
}: Omit<MenuPrimitive.SubmenuRoot.Props, "children" | "actionsRef"> & {
  children?: React.ReactNode;
}) {
  const { rootProps, presence } = useOverlayOpen<
    MenuPrimitive.SubmenuRoot.ChangeEventDetails,
    MenuPrimitive.Root.Actions
  >({ open, defaultOpen, onOpenChange, onOpenChangeComplete });
  return (
    <MenuPrimitive.SubmenuRoot {...props} {...rootProps}>
      <OverlayPresenceContext value={presence}>
        {children}
      </OverlayPresenceContext>
    </MenuPrimitive.SubmenuRoot>
  );
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props &
  AsChild & {
    inset?: boolean;
  }) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex min-h-7 cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs outline-hidden motion-ink select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-inset:pl-7.5 data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground coarse:min-h-11 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      {...composeRender(props)}
    >
      {children}
      <IconChevronRight className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  side = "inline-end",
  align = "start",
  sideOffset,
  alignOffset,
  collisionPadding,
  ...props
}: Omit<MenuPrimitive.Popup.Props, "className" | "render"> &
  Pick<
    MenuPrimitive.Positioner.Props,
    "side" | "align" | "sideOffset" | "alignOffset" | "collisionPadding"
  > & { className?: string }) {
  const { open, onExitComplete } = useOverlayPresence("DropdownMenuSubContent");
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <DropdownMenuPortal key="dropdown-menu-sub-portal" keepMounted>
          <MenuPrimitive.Positioner
            side={side}
            align={align}
            sideOffset={sideOffset}
            alignOffset={alignOffset}
            collisionPadding={collisionPadding}
            className="z-50"
          >
            <MenuPrimitive.Popup
              data-slot="dropdown-menu-sub-content"
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
              className={cn(MENU_POPUP, "min-w-32", className)}
              {...props}
            />
          </MenuPrimitive.Positioner>
        </DropdownMenuPortal>
      )}
    </AnimatePresence>
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
