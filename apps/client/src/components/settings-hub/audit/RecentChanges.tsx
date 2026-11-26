"use client";

import { Chronology, ChronologyEntry } from "@/components/activity/Chronology";
import type { SettingsAuditEntry } from "@workspace/api/api";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import { CollapsibleSection } from "@workspace/ui/components/layout/collapsible-section";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { pluralizeCount } from "@workspace/session-diff/format";
import { useEffect, useState } from "react";
import { readSettingsAudit, type AuditTarget } from "../api";
import { sameSettingValue, settingLabel, settingOf } from "../format";
import { ValueChange } from "../ValueChange";

/** How many changes one page of the list reads. */
export const CHANGES_PAGE = 20;

/** Who a change is by, once their account is gone. */
const REMOVED_ACCOUNT = "a removed account";

type Changes = {
  entries: SettingsAuditEntry[];
  /** Whether an older page may follow: the last one came back full. */
  more: boolean;
  /** The page on its way: the first, or the next older one. */
  loading: "first" | "next" | null;
  /** Why the latest page did not load. */
  error: string | null;
  /** What the last page added, for a screen reader. */
  announced: string;
};

const FIRST: Changes = {
  entries: [],
  more: false,
  loading: "first",
  error: null,
  announced: "",
};

type Page = SettingsAuditEntry[] | ActionError;

/** The list once a page arrived: the first, or (`older`) the one after the entries held. */
const withPage = (held: Changes, page: Page, older: boolean): Changes =>
  isActionError(page)
    ? { ...held, loading: null, error: page.error }
    : {
        entries: older ? [...held.entries, ...page] : page,
        more: page.length === CHANGES_PAGE,
        loading: null,
        error: null,
        announced: older
          ? pluralizeCount(page.length, "more change")
          : held.announced,
      };

/**
 * One change: who made it, to which setting, and what it did, the value's move
 * read through the setting's control and a lock's as "locked" or "unlocked".
 * A setting the registry no longer knows reads as its key and raw values.
 */
function ChangeLine({ entry }: { entry: SettingsAuditEntry }) {
  const locking = entry.lockedBefore !== entry.lockedAfter;
  const moved = !sameSettingValue(entry.old, entry.new);
  const format = useFormat();

  return (
    <ChronologyEntry at={entry.at} format={format}>
      <span className={entry.actor ? undefined : "text-ink-soft"}>
        {entry.actor?.name ?? REMOVED_ACCOUNT}
      </span>
      <span className="text-ink-soft"> · </span>
      <span className="break-all">{settingLabel(entry.key)}</span>
      <span className="text-ink-soft"> · </span>
      {locking && <span>{entry.lockedAfter ? "locked" : "unlocked"}</span>}
      {locking && moved && <span className="text-ink-soft"> · </span>}
      {(moved || !locking) && (
        <ValueChange
          definition={settingOf(entry.key)}
          from={entry.old}
          to={entry.new}
        />
      )}
    </ChronologyEntry>
  );
}

/** The chronology's shape while its first page loads. */
function ChangesSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the recent changes"
      className="flex flex-col gap-3 border-l border-rule py-2 pl-4"
    >
      {["w-3/5", "w-2/5", "w-1/2"].map((width) => (
        <Skeleton key={width} className={`h-3 ${width}`} />
      ))}
    </div>
  );
}

/** The changes at one scope, newest first, a page at a time. */
function ChangesList({ target }: { target: AuditTarget }) {
  const { scope, id } = target;
  const [changes, setChanges] = useState<Changes>(FIRST);

  useEffect(() => {
    // Folding the section away unmounts the list; a page it asked for then is dropped.
    let live = true;
    void readSettingsAudit({ scope, id } as AuditTarget, {
      limit: CHANGES_PAGE,
    }).then((page) => {
      if (live) setChanges((held) => withPage(held, page, false));
    });
    return () => {
      live = false;
    };
  }, [scope, id]);

  /** Reads the next older page, or the first again after it failed. */
  const load = async () => {
    const last = changes.entries.at(-1);
    setChanges((held) => ({
      ...held,
      loading: last ? "next" : "first",
      error: null,
    }));
    const page = await readSettingsAudit(target, {
      limit: CHANGES_PAGE,
      ...(last ? { before: last.id } : {}),
    });
    setChanges((held) => withPage(held, page, last !== undefined));
  };

  const { entries, more, loading, error, announced } = changes;

  if (loading === "first") return <ChangesSkeleton />;

  if (entries.length === 0) {
    return error ? (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="text-small text-pretty text-danger">
          Couldn't load the recent changes. {error}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void load()}
        >
          Try again
        </Button>
      </div>
    ) : (
      <p className="max-w-[54ch] text-small text-pretty text-ink-soft">
        Nothing has changed here yet. Each change to these settings shows here:
        who made it, and when.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Chronology>
        {entries.map((entry) => (
          <ChangeLine key={entry.id} entry={entry} />
        ))}
      </Chronology>
      {error && (
        <p role="alert" className="text-small text-pretty text-danger">
          Couldn't load more. {error}
        </p>
      )}
      {more && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={loading === "next"}
          aria-busy={loading === "next" || undefined}
          onClick={() => void load()}
        >
          {loading === "next" && (
            <Spinner aria-hidden data-icon="inline-start" />
          )}
          {error ? "Try again" : "Show more"}
        </Button>
      )}
      <p role="status" className="sr-only">
        {announced}
      </p>
    </div>
  );
}

/**
 * The read-only list of the latest changes to a project's or the instance's
 * settings, at the foot of its section: who changed which setting, from what
 * to what, and when, newest first, "Show more" reading older ones. Folded
 * until opened, as a page's history is; it reads nothing until then.
 */
export function RecentChanges({ target }: { target: AuditTarget }) {
  return (
    <section aria-label="Recent changes">
      <CollapsibleSection label="Recent changes" defaultOpen={false}>
        <ChangesList target={target} />
      </CollapsibleSection>
    </section>
  );
}
