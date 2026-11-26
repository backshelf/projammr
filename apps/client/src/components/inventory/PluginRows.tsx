"use client";

import { useInventorySearch } from "@/components/inventory/inventory-search-context";
import { AppLink } from "@/components/navigation/AppLink";
import { useRevealOpenRow } from "@/hooks/use-reveal-open-row";
import { useShellPolicy } from "@/lib/policies/provider";
import {
  deviceMeta,
  pluginsPageHref,
  type PluginOrigin,
} from "@/lib/plugins-graph";
import { hrefFromParsedRoute } from "@/lib/utils";
import type { PluginSession, PluginUsage } from "@workspace/api/api";
import {
  Row,
  RowMain,
  RowMeta,
  Rows,
  RowTitle,
} from "@workspace/ui/components/layout/rows";
import { pluralizeCount } from "@workspace/session-diff/format";
import { cn } from "@workspace/ui/lib/utils";
import { useMemo } from "react";

function matchesSearch(plugin: PluginUsage, query: string): boolean {
  return (
    plugin.name.toLowerCase().includes(query) ||
    (plugin.manufacturer ?? "").toLowerCase().includes(query)
  );
}

/**
 * The devices the origin tab left standing, most-used first, as rows that open
 * on `?device=` to list the sessions carrying them. The search box lives in
 * the page head; this list only reads it, from {@link useInventorySearch}.
 * `emptyLine` is what to say when the server left no device to list.
 */
export function PluginRows({
  projectId,
  plugins,
  origin,
  stock,
  emptyLine,
  expanded,
}: {
  projectId: number;
  plugins: PluginUsage[];
  /** The tab the rows link within; a row's link adds `device`. */
  origin?: PluginOrigin;
  /** Kept on every row's link, so opening a row leaves the web as it is. */
  stock?: boolean;
  emptyLine: string;
  /** The open row's device and the sessions carrying it, already read by the server. */
  expanded?: { device: string; sessions: PluginSession[] };
}) {
  const { query } = useInventorySearch();
  const listRef = useRevealOpenRow<HTMLDivElement>(expanded?.device);

  const visible = useMemo(
    () =>
      query
        ? plugins.filter((plugin) => matchesSearch(plugin, query))
        : plugins,
    [plugins, query]
  );

  if (plugins.length === 0) {
    return <p className="text-small text-ink-soft">{emptyLine}</p>;
  }

  if (visible.length === 0) {
    return <p className="text-small text-ink-soft">No devices match.</p>;
  }

  return (
    <div ref={listRef}>
      <Rows>
        {visible.map((plugin) => (
          <PluginRow
            key={plugin.name}
            projectId={projectId}
            plugin={plugin}
            origin={origin}
            stock={stock}
            sessions={
              expanded?.device === plugin.name ? expanded.sessions : undefined
            }
          />
        ))}
      </Rows>
    </div>
  );
}

function PluginRow({
  projectId,
  plugin,
  origin,
  stock,
  sessions,
}: {
  projectId: number;
  plugin: PluginUsage;
  origin?: PluginOrigin;
  stock?: boolean;
  sessions?: PluginSession[];
}) {
  const open = sessions !== undefined;
  const defaults = useShellPolicy().inventoryDefaults.plugins;

  return (
    <>
      <Row
        as={AppLink}
        href={pluginsPageHref(
          projectId,
          {
            origin: origin ?? "all",
            stock,
            device: open ? undefined : plugin.name,
          },
          defaults
        )}
        scroll={false}
        aria-current={open ? "true" : undefined}
        className={cn(open && "border-l-2 border-art")}
      >
        <RowMain>
          <RowTitle
            className={
              plugin.origin === "builtin" ? "text-ink-soft" : undefined
            }
          >
            {plugin.name}
          </RowTitle>
          <RowMeta>{deviceMeta(plugin)}</RowMeta>
        </RowMain>
        <span className="w-20 shrink-0 text-right text-micro text-ink-soft tabular-nums">
          {pluralizeCount(plugin.sessions, "set")}
        </span>
        <span className="w-16 shrink-0 text-right text-micro text-ink-soft tabular-nums">
          {pluralizeCount(plugin.tracks, "track")}
        </span>
      </Row>
      {sessions && (
        <PluginSessionRows projectId={projectId} sessions={sessions} />
      )}
    </>
  );
}

/** The sessions a device sits in, drilled in under its row in the list. */
function PluginSessionRows({
  projectId,
  sessions,
}: {
  projectId: number;
  sessions: PluginSession[];
}) {
  if (sessions.length === 0) {
    return (
      <p className="py-2 pl-8 text-micro text-ink-soft">
        No sessions carry this device.
      </p>
    );
  }

  return (
    <Rows>
      {sessions.map((session) => (
        <Row
          as={AppLink}
          key={session.id}
          href={hrefFromParsedRoute(
            {
              kind: "session",
              sessionId: session.id,
              trackId: session.trackId ?? undefined,
            },
            projectId
          )}
          className="pl-8"
        >
          <RowMain>
            <RowTitle>{session.name}</RowTitle>
            <RowMeta>
              on {session.onTracks.join(", ")}
              {session.trackTitle && ` · ${session.trackTitle}`}
            </RowMeta>
          </RowMain>
        </Row>
      ))}
    </Rows>
  );
}
