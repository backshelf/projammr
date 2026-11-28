"use client";

import {
  NOTEBOOK_SCOPE,
  type NotebookSurface,
} from "@/components/commands/notebook";
import { useCommandScope } from "@/components/commands/provider";
import { AppLink } from "@/components/navigation/AppLink";
import { useNotebook } from "@/components/notebook/NotebookShell";
import {
  hrefFromParsedRoute,
  NEW_NOTE_HREF,
  noteHref,
  noteIdFromPath,
  noteTitle,
} from "@/lib/utils";
import { useFormat } from "@workspace/ui/components/format-provider";
import { IconNotebook } from "@tabler/icons-react";
import type { NoteSummary } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { Input } from "@workspace/ui/components/input";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

/** Outside a `NotebookShell` there is no list — one identity, so no re-render. */
const NO_NOTES: NoteSummary[] = [];

/** The notebook's left pane: every note the signed-in user has written. */
export function NoteList() {
  const summaries = useNotebook()?.summaries ?? NO_NOTES;
  const selectedId = noteIdFromPath(usePathname());
  const router = useRouter();
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return summaries;
    return summaries.filter(
      (note) =>
        note.title.toLowerCase().includes(q) ||
        note.preview.toLowerCase().includes(q)
    );
  }, [summaries, query]);

  const pinned = matches.filter((note) => note.pinned);
  const rest = matches.filter((note) => !note.pinned);

  // The keys read the latest render, so the surface changes only when what
  // they can do does.
  const filterRef = useRef<HTMLInputElement>(null);
  const moves = useLatestRef({
    step: (delta: 1 | -1) => {
      const visible = [...pinned, ...rest];
      const at = visible.findIndex((note) => note.id === selectedId);
      const next =
        at === -1
          ? visible[delta === 1 ? 0 : visible.length - 1]
          : visible[Math.min(Math.max(at + delta, 0), visible.length - 1)];
      if (next && next.id !== selectedId) router.push(noteHref(next.id));
    },
    focusFilter: () => filterRef.current?.focus(),
  });
  const canStep = matches.length > 0;
  const hasFilter = summaries.length > 0;
  const surface = useMemo<NotebookSurface>(
    () => ({
      step: canStep ? (delta) => moves.current.step(delta) : null,
      focusFilter: hasFilter ? () => moves.current.focusFilter() : null,
    }),
    [moves, canStep, hasFilter]
  );
  useCommandScope(NOTEBOOK_SCOPE, surface, true);

  return (
    <div className={"flex min-h-full flex-col gap-4 px-(--gutter) pb-8"}>
      {/* An empty notebook offers New once, in its empty state. */}
      <PageHead
        size={"subtitle"}
        title={"Notebook"}
        action={summaries.length > 0 ? <NewNoteButton /> : undefined}
      />

      {summaries.length === 0 ? (
        <Empty className={"px-0"}>
          <EmptyHeader>
            <EmptyMedia variant={"icon"}>
              <IconNotebook />
            </EmptyMedia>
            <EmptyTitle>No notes yet</EmptyTitle>
            <EmptyDescription>
              Write lyrics here, then link them to a track when they&rsquo;re
              ready
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewNoteButton />
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <Input
            ref={filterRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={"Filter notes…"}
            className={"md:text-small"}
          />
          {matches.length === 0 ? (
            <p className={"py-6 text-center text-small text-ink-soft"}>
              Nothing matches your search.
            </p>
          ) : pinned.length > 0 ? (
            <>
              <NoteSection
                label={"Pinned"}
                notes={pinned}
                selectedId={selectedId}
              />
              <NoteSection
                label={"Notes"}
                notes={rest}
                selectedId={selectedId}
              />
            </>
          ) : (
            <NoteRows notes={rest} selectedId={selectedId} />
          )}
        </>
      )}
    </div>
  );
}

function NewNoteButton() {
  return (
    <Button variant={"ghost"} size={"sm"} asChild>
      <AppLink href={NEW_NOTE_HREF}>New</AppLink>
    </Button>
  );
}

function NoteSection({
  label,
  notes,
  selectedId,
}: {
  label: string;
  notes: NoteSummary[];
  selectedId: number | null;
}) {
  if (notes.length === 0) return null;

  return (
    <div>
      <h2 className={cn(LABEL, "mb-1 text-ink-soft")}>{label}</h2>
      <NoteRows notes={notes} selectedId={selectedId} />
    </div>
  );
}

function NoteRows({
  notes,
  selectedId,
}: {
  notes: NoteSummary[];
  selectedId: number | null;
}) {
  return (
    <Rows>
      {notes.map((note) => (
        <NoteRow key={note.id} note={note} selected={note.id === selectedId} />
      ))}
    </Rows>
  );
}

/**
 * The row is the note's link, stretched over the whole row from its title so
 * the linked track's chip can be a second link — to the track's page — without
 * one anchor sitting inside another.
 */
function NoteRow({ note, selected }: { note: NoteSummary; selected: boolean }) {
  const format = useFormat();

  return (
    <Row
      className={cn(
        "relative",
        selected && "bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
      )}
    >
      <RowMain>
        <AppLink
          href={noteHref(note.id)}
          aria-current={selected ? "page" : undefined}
          className={"block min-w-0 after:absolute after:inset-0"}
        >
          <RowTitle className={cn(!note.title && "text-ink-soft italic")}>
            {noteTitle(note.title)}
          </RowTitle>
        </AppLink>
        <div className={"mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1"}>
          <RowMeta className={"min-w-0 flex-1"}>
            {format.relative(note.updatedAt)}
            {note.preview && ` · ${note.preview}`}
          </RowMeta>
          {note.track && (
            <StatusChip
              flag
              colour={"var(--ink-soft)"}
              className={"relative z-10 max-w-36 shrink-0"}
            >
              <AppLink
                href={hrefFromParsedRoute(
                  { kind: "track", trackId: note.track.id },
                  note.track.projectId
                )}
                title={note.track.title}
                className={"min-w-0 truncate hover:underline"}
              >
                {note.track.title}
              </AppLink>
            </StatusChip>
          )}
        </div>
      </RowMain>
    </Row>
  );
}
