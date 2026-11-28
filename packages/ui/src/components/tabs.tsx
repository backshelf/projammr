"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { useHaptics } from "@workspace/ui/components/haptics";
import { LayoutGroup, m, SPRING } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

function Tabs({
  className,
  orientation = "horizontal",
  value,
  defaultValue,
  onValueChange,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const haptic = useHaptics();
  // A pointer press both focuses the trigger and mousedowns it, and Base UI
  // announces the value on each, so the tab that is already showing is
  // remembered and only a real move between tabs rings.
  const rungForRef = React.useRef(value ?? defaultValue);

  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      orientation={orientation}
      value={value}
      defaultValue={defaultValue}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      onValueChange={(next, eventDetails) => {
        if (rungForRef.current !== next) {
          rungForRef.current = next;
          haptic();
        }
        onValueChange?.(next, eventDetails);
      }}
      {...props}
    />
  );
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-horizontal/tabs:h-8 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none coarse:h-auto group-data-horizontal/tabs:coarse:h-auto",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

/** Scopes the sliding indicator's shared layout id to this list, so two tab
 *  lists on the same page never trade places with each other's indicator. */
function TabsList({
  className,
  variant = "default",
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const layoutId = React.useId();
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      <LayoutGroup id={layoutId}>{children}</LayoutGroup>
    </TabsPrimitive.List>
  );
}

/** The active tab's indicator: a pill behind the label for `default`, an
 *  underline below it for `line`. `layoutId` is what makes it one shared
 *  element sliding between triggers rather than each trigger fading its own
 *  in and out. */
const INDICATOR = cn(
  "pointer-events-none absolute -z-10",
  "group-data-[variant=default]/tabs-list:inset-0 group-data-[variant=default]/tabs-list:rounded-md group-data-[variant=default]/tabs-list:bg-background dark:group-data-[variant=default]/tabs-list:bg-input/30",
  "group-data-[variant=line]/tabs-list:bg-foreground",
  "group-data-[variant=line]/tabs-list:group-data-horizontal/tabs:inset-x-0 group-data-[variant=line]/tabs-list:group-data-horizontal/tabs:-bottom-[5px] group-data-[variant=line]/tabs-list:group-data-horizontal/tabs:h-0.5",
  "group-data-[variant=line]/tabs-list:group-data-vertical/tabs:inset-y-0 group-data-[variant=line]/tabs-list:group-data-vertical/tabs:-right-1 group-data-[variant=line]/tabs-list:group-data-vertical/tabs:w-0.5"
);

function TabsTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Tab>) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-foreground/60 motion-ink group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start group-data-vertical/tabs:py-[calc(--spacing(1.25))] hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground data-active:text-foreground dark:data-active:border-input dark:data-active:text-foreground dark:group-data-[variant=line]/tabs-list:data-active:border-transparent coarse:min-h-11 coarse:text-base [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className
      )}
      render={(triggerProps, state) => (
        <button {...triggerProps}>
          {children}
          {state.active && (
            <m.span
              data-slot="tabs-indicator"
              layoutId="indicator"
              transition={SPRING.control}
              className={INDICATOR}
            />
          )}
        </button>
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Panel>) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-xs/relaxed outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants };
