"use client";

import { useCommandPalette } from "@/components/command-palette/command-palette-context";
import { dockTabs, type Tab, type TabContext } from "@/components/dock/tabs";
import { AppLink } from "@/components/navigation/AppLink";
import { useLongPress } from "@/hooks/use-long-press";
import { useTabContext } from "@/hooks/use-tab-context";
import { useShellPolicy } from "@/lib/policies/provider";
import { useHaptics } from "@workspace/ui/components/haptics";
import { LayoutGroup, m, SPRING } from "@workspace/ui/lib/motion";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * The phone's primary navigation: one row of tabs across the bottom of a
 * project, the notebook or the settings hub. Anywhere else there is nothing
 * to navigate between, so the bar is absent rather than empty.
 */
export function TabBar() {
  const context = useTabContext();
  const tabs = dockTabs(useShellPolicy().dockTabs);

  if (!context) return null;

  return (
    <nav
      data-slot={"tabbar"}
      aria-label={"Sections"}
      className={"flex h-(--tabbar-height) border-t border-rule bg-paper-sunk"}
    >
      <LayoutGroup id={"tabbar"}>
        {tabs.map((tab) => (
          <TabItem key={tab.id} tab={tab} context={context} />
        ))}
      </LayoutGroup>
    </nav>
  );
}

function TabItem({ tab, context }: { tab: Tab; context: TabContext }) {
  const { open, setOpen } = useCommandPalette();
  const haptic = useHaptics();
  const router = useRouter();
  const active = tab.isActive(context);

  const shortcut =
    tab.kind === "link" ? (tab.longPressHref?.(context) ?? null) : null;
  const followShortcut = useCallback(() => {
    if (shortcut !== null) router.push(shortcut);
  }, [router, shortcut]);
  const { handlers: longPress, pressing } = useLongPress(followShortcut);

  const body = (
    <>
      {/* The lit tab is marked at the bar's own edge, so the mark reads as part
          of the hairline rather than as a badge on the icon. */}
      {active && (
        <m.span
          layoutId={"tabbar-mark"}
          transition={SPRING.control}
          aria-hidden
          className={"absolute inset-x-0 top-0 h-0.5 bg-art"}
        />
      )}
      <span className={"relative inline-flex"}>
        <tab.icon
          className={"size-5 motion-press group-active/tab:scale-[0.98]"}
        />
        {shortcut !== null && (
          <span
            aria-hidden
            data-slot={"tab-shortcut-hint"}
            className={
              "absolute -top-0.5 -right-1 size-1 rounded-full bg-ink-faint"
            }
          />
        )}
      </span>
      <span className={LABEL}>{tab.label}</span>
    </>
  );

  const className = cn(
    "group/tab relative flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5",
    active ? "text-ink" : "text-ink-soft",
    // iOS answers a held link with its own preview and callout menu, which
    // would rise over the shortcut this tab holds for the same gesture.
    shortcut !== null &&
      "motion-settle select-none [-webkit-touch-callout:none] data-pressing:scale-[0.95]"
  );

  if (tab.kind === "palette") {
    return (
      <button
        type={"button"}
        className={className}
        aria-haspopup={"dialog"}
        aria-expanded={open}
        onClick={() => {
          haptic();
          setOpen(true);
        }}
      >
        {body}
      </button>
    );
  }

  const href = tab.href(context);
  if (href === null) return null;

  return (
    <AppLink
      href={href}
      className={className}
      data-pressing={shortcut !== null && pressing ? true : undefined}
      aria-description={shortcut !== null ? "Hold for quick jump" : undefined}
      {...(shortcut !== null ? longPress : {})}
      // A tab that is already the page is not a move between options, so it
      // stays silent — the same rule the Tabs primitive follows.
      onClick={() => {
        if (!active) haptic();
      }}
      aria-current={active ? "page" : undefined}
    >
      {body}
    </AppLink>
  );
}
