"use client";

import { deleteNote, unlinkNote } from "@/actions/notes";
import { AppLink } from "@/components/navigation/AppLink";
import { NOTE_SCOPE, type NoteSurface } from "@/components/commands/notebook";
import { useCommandScope } from "@/components/commands/provider";
import { copyNoteText } from "@/components/notebook/copy-note-text";
import { LinkNoteDialog } from "@/components/notebook/LinkNoteDialog";
import { useNotebook } from "@/components/notebook/NotebookShell";
import {
  createSaveQueue,
  type Draft,
  type SaveState,
} from "@/components/notebook/save-queue";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { createNoteClient, saveNoteClient } from "@/lib/notes-client";
import { useSetting } from "@/lib/settings/provider";
import { noteHref, noteIdFromPath, NOTES_HREF } from "@/lib/utils";
import { IconDotsVertical } from "@tabler/icons-react";
import type { NoteDetail } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import type {
  BlockEditorProps,
  EditorVariant,
} from "@workspace/ui/components/block-editor";
import { splitSoftBreaks } from "@workspace/ui/components/block-editor/lyrics/normalise";
import {
  isBlankDocument,
  parseInitialValue,
} from "@workspace/ui/lib/block-document";
import { Button } from "@workspace/ui/components/button";
import { REVEAL_FOCUS } from "@workspace/ui/lib/reveal-focus";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { IconButton } from "@workspace/ui/components/icon-button";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import dynamic from "next/dynamic";
import { useTheme } from "@/components/theme/AppThemeProvider";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { toast } from "sonner";

const BlockNoteEditor: ComponentType<BlockEditorProps> = dynamic(
  () =>
    import("@workspace/ui/components/block-editor").then(
      (next) => next.BlockEditor
    ),
  { ssr: false }
);

const EMPTY_DOCUMENT = JSON.stringify([{ type: "paragraph" }]);

/** Every right a draft has: it is the caller's, and there is nothing to act on. */
const DRAFT_RIGHTS = { write: true, unlink: false, delete: false };

type Surface = "notebook" | "track";

/** What an empty editor invites, which is whatever the surface is for. */
const PLACEHOLDER: Record<Surface, string> = {
  notebook: "Write something…",
  track: "Write lyrics…",
};

/** The pieces a surface lays out around the note: where they go is its call. */
type NoteEditorParts = {
  /** The save state, as a line of text. */
  status: ReactNode;
  /** The `⋯` menu holding every action the note allows. */
  menu: ReactNode;
  /** The editing surface itself. */
  editor: ReactNode;
};

/** An existing row, or a blank draft bound to no row yet. */
export type NoteSource =
  { note: NoteDetail; draft?: never } | { note?: never; draft: Draft };

export type NoteEditorProps = {
  surface: Surface;
  layout: (parts: NoteEditorParts) => ReactNode;
} & NoteSource;

type Identity = { id: number; version: number } | null;

const identityOf = (note: NoteDetail | undefined): Identity =>
  note ? { id: note.id, version: note.version } : null;

/**
 * One note, open for editing — the notebook's right pane and, on a track page,
 * that track's lyrics. The row's identity (null until the first save creates
 * it), the document, the save queue and the mode all live in the inner
 * component; this wrapper decides when that state has to be thrown away and
 * started again from the props, which a route refresh cannot do on its own:
 *
 * - the address names a different row (another note picked, a link made or
 *   removed under a track, a delete, or the notebook's New link pressed);
 * - the server's version is ahead of the one the editor holds, which is what
 *   "Reload" after a conflict needs to see.
 */
export function NoteEditor(props: NoteEditorProps) {
  const pathname = usePathname();
  // The row the session below holds, as it last reported it — the created
  // note's id and the version of its latest save.
  const [held, setHeld] = useState<Identity>(() => identityOf(props.note));
  const [epoch, setEpoch] = useState(0);
  const [seen, setSeen] = useState({ note: props.note, pathname });

  if (seen.note !== props.note || seen.pathname !== pathname) {
    setSeen({ note: props.note, pathname });
    // A draft's first save rewrites the address to its new note without a
    // navigation, so the route is still `new` and hands down no note at all:
    // the pathname is the only place that row is named, and reading it as
    // "a different row" would throw away the text that just created it.
    const named = props.note?.id ?? noteIdFromPath(pathname);
    const differentRow = named !== (held?.id ?? null);
    const serverAhead =
      props.note != null && held != null && props.note.version > held.version;
    if (differentRow || serverAhead) {
      setHeld(identityOf(props.note));
      setEpoch((current) => current + 1);
    }
  }

  return <NoteEditorSession key={epoch} {...props} onIdentity={setHeld} />;
}

function NoteEditorSession({
  surface,
  layout,
  note,
  draft,
  onIdentity,
}: NoteEditorProps & { onIdentity: (identity: Identity) => void }) {
  const router = useRouter();
  const notebook = useNotebook();
  const { resolvedTheme } = useTheme();
  const newNoteMode = useSetting("editor.newNoteMode");

  const [initialDocument] = useState(() =>
    note ? JSON.stringify(note.body) : EMPTY_DOCUMENT
  );
  // The text as typed. Nothing renders it: the editor owns its document from
  // the moment it mounts, so holding it in state would re-render everything
  // on every keystroke to show the same thing.
  const docRef = useRef(initialDocument);
  // What the editor mounts with. A mounted editor never re-reads this, so it
  // changes only when the mode switch remounts it — and then it has to be the
  // text as typed, or the switch would discard everything since the load.
  const [mount, setMount] = useState<{ variant: EditorVariant; value: string }>(
    () => ({
      variant: (
        note ? note.lyricsMode : (draft?.lyricsMode ?? newNoteMode === "lyrics")
      )
        ? "lyrics"
        : "plain",
      value: initialDocument,
    })
  );
  const [state, setState] = useState<SaveState>(note ? "saved" : "draft");
  const [linking, setLinking] = useState(false);
  // The row as the server last described it — null while this is still a
  // draft. The menu reads its rights, its pin and its title from here, so a
  // draft's first save turns the actions on without a navigation, and a
  // refresh after a link or unlink brings the new rights in.
  const [row, setRow] = useState<NoteDetail | null>(note ?? null);
  const [seenNote, setSeenNote] = useState(note);
  if (note !== seenNote) {
    setSeenNote(note);
    if (note) setRow(note);
  }

  // The queue outlives the render that built it, so its callbacks read the
  // current ones through a ref rather than the ones captured at mount.
  const onSaved = useLatestRef((saved: NoteDetail, created: boolean) => {
    onIdentity({ id: saved.id, version: saved.version });
    setRow(saved);
    notebook?.upsert(saved);
    if (!created) return;
    if (surface === "notebook") {
      // Not a router navigation: Next syncs `usePathname` with the History
      // API without re-rendering the route, so the editor keeps its focus and
      // caret while the address bar becomes the saved note's own URL.
      window.history.replaceState(null, "", noteHref(saved.id));
    } else {
      // The track page reads the link from the server, so it has to re-read.
      router.refresh();
    }
  });

  const [queue] = useState(() =>
    createSaveQueue(
      identityOf(note),
      { ...draft, lyricsMode: mount.variant === "lyrics" },
      {
        create: createNoteClient,
        save: saveNoteClient,
        onSaved: (saved, created) => onSaved.current(saved, created),
        onState: setState,
      }
    )
  );

  // Bound once: going away is the only thing that runs this, and the pending
  // save is not awaited — blocking the navigation on the round trip would
  // show as a stall.
  useEffect(() => {
    return () => void queue.settle();
  }, [queue]);

  const rights = row?.can ?? DRAFT_RIGHTS;
  // Pinning and linking are the author's alone, as deleting is.
  const isAuthor = rights.delete;
  const noteId = queue.identity?.id ?? null;
  const lyricsMode = mount.variant === "lyrics";

  async function setMode(next: boolean) {
    if (next) {
      docRef.current = JSON.stringify(
        splitSoftBreaks(parseInitialValue(docRef.current))
      );
    }
    // A draft with nothing typed yet stays a draft: the mode is remembered
    // for the create, not written as an empty note.
    const blank =
      !queue.identity && isBlankDocument(parseInitialValue(docRef.current));
    queue.queue(
      blank
        ? { lyricsMode: next }
        : { body: JSON.parse(docRef.current), lyricsMode: next },
      0
    );
    // The remount below must not race a save still carrying the old mode.
    await queue.settle();
    setMount({ variant: next ? "lyrics" : "plain", value: docRef.current });
  }

  const pin = async () => {
    if (!noteId) return;
    queue.queue({ pinned: !row?.pinned }, 0);
    await queue.settle();
    router.refresh();
  };

  const copy = () => {
    if (!noteId) return;
    void copyNoteText(noteId)
      .then(() => toast.success("Copied"))
      .catch(() => toast.error("Couldn't copy note"));
  };

  // The menu's own conditions: a note links to a track only while it is
  // saved, the author's and not linked already.
  const canCopy = noteId !== null;
  const canLink = noteId !== null && isAuthor && !rights.unlink;
  const keys = useLatestRef({ copy, link: () => setLinking(true) });
  const noteSurface = useMemo<NoteSurface>(
    () => ({
      copy: canCopy ? () => keys.current.copy() : null,
      link: canLink ? () => keys.current.link() : null,
    }),
    [keys, canCopy, canLink]
  );
  useCommandScope(NOTE_SCOPE, noteSurface, surface === "notebook");

  const unlink = async () => {
    if (!noteId) return;
    const result = await unlinkNote(noteId);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
  };

  const remove = async () => {
    if (!noteId) return;
    const result = await deleteNote(noteId);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    notebook?.remove(noteId);
    if (surface === "notebook") router.push(NOTES_HREF);
    router.refresh();
  };
  const deletion = useDeleteGate("note", remove);

  const status = (
    <SaveStateLabel state={state} onReload={() => router.refresh()} />
  );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label={"Note actions"}>
          <IconDotsVertical />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={"end"}>
        <DropdownMenuCheckboxItem
          checked={lyricsMode}
          disabled={!rights.write}
          onSelect={() => void setMode(!lyricsMode)}
        >
          Lyrics mode
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={!noteId || !isAuthor}
          onSelect={() => void pin()}
        >
          {row?.pinned ? "Unpin" : "Pin"}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!noteId} onSelect={copy}>
          Copy as plain text
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {rights.unlink ? (
          <DropdownMenuItem onSelect={() => void unlink()}>
            Unlink from track
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={!canLink}
            onSelect={() => keys.current.link()}
          >
            Link to track
          </DropdownMenuItem>
        )}
        {surface === "track" && noteId && (
          <DropdownMenuItem asChild>
            <AppLink href={noteHref(noteId)}>Open in Notebook</AppLink>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant={"destructive"}
          disabled={!noteId || !isAuthor}
          onSelect={() => deletion.request()}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const editor = (
    // No explicit width: `.doc-surface` bleeds into the gutter with a
    // negative inline margin, and a 100% width would pin its right edge.
    <div
      className={"doc doc-surface min-h-40 flex-1"}
      data-variant={mount.variant}
      {...REVEAL_FOCUS}
    >
      <BlockNoteEditor
        key={mount.variant}
        variant={mount.variant}
        value={mount.value}
        onChange={(json) => {
          docRef.current = json;
          queue.queue({ body: JSON.parse(json) }, 1500);
        }}
        editable={rights.write && state !== "conflict"}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        placeholder={rights.write ? PLACEHOLDER[surface] : " "}
      />
    </div>
  );

  return (
    <>
      {layout({ status, menu, editor })}
      {noteId && (
        <LinkNoteDialog
          open={linking}
          onOpenChange={setLinking}
          noteId={noteId}
        />
      )}
      <ConfirmDeleteDialog
        {...deletion.dialog}
        title={`Delete "${row?.title || "this note"}"?`}
      />
    </>
  );
}

const STATE_LABELS: Record<SaveState, string> = {
  draft: "New note",
  saved: "Saved",
  unsaved: "Unsaved",
  saving: "Saving…",
  conflict: "This note changed elsewhere",
  error: "Couldn’t save",
};

function SaveStateLabel({
  state,
  onReload,
}: {
  state: SaveState;
  onReload: () => void;
}) {
  const failed = state === "conflict" || state === "error";

  return (
    <span
      className={"flex items-center gap-1.5 text-micro"}
      aria-live={"polite"}
    >
      <span className={failed ? "text-danger" : "text-ink-soft"}>
        {STATE_LABELS[state]}
      </span>
      {state === "conflict" && (
        <Button
          variant={"ghost"}
          size={"xs"}
          className={"coarse:min-h-11"}
          onClick={onReload}
        >
          Reload
        </Button>
      )}
    </span>
  );
}
