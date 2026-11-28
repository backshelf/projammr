"use client";

import type {
  Block,
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  PartialBlock,
  StyleSchema,
  Styles,
} from "@blocknote/core";
import type { Command } from "prosemirror-state";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { useEditorFocus, useEditorState } from "@blocknote/react";
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconItalic,
  IconListCheck,
  IconPlus,
} from "@tabler/icons-react";
import {
  keyboardInset,
  useKeyboardInset,
} from "@workspace/ui/hooks/use-keyboard-inset";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { cn } from "@workspace/ui/lib/utils";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { LyricsPrefixes } from "./lyrics/context";

function isBlockEmpty<
  B extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
>(block: Block<B, I, S>): boolean {
  if (!Array.isArray(block.content)) return false;
  return (
    block.content.length === 0 ||
    block.content.every(
      (item) =>
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string" &&
        item.text.length === 0
    )
  );
}

/** Keep caret and soft keyboard inside `.ProseMirror` when tapping bar tools. */
const keepEditorFocus = (event: React.MouseEvent<HTMLButtonElement>) => {
  event.preventDefault();
};

const BAR_BUTTON = cn(
  "inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md px-2 text-ink-soft motion-press",
  "hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)] hover:text-ink",
  "focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-hidden",
  "aria-pressed:bg-art/15 aria-pressed:text-art",
  "disabled:pointer-events-none disabled:opacity-35"
);

/**
 * Mobile keyboard accessory bar for block/lyrics editors: `+ Section`,
 * `Rhymes`, `Synonyms`, `Checklist`, `B/I`, and `Undo/Redo`, pinned directly
 * above the soft keyboard on iOS (`visualViewport` inset) and Android
 * (`resizes-content` + `--dock: 0px`), or above `Dock` during touch emulation.
 */
export function EditorAccessoryBar<
  B extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
>({
  editor,
  editable,
  lyricsPrefixes,
}: {
  editor: BlockNoteEditor<B, I, S>;
  editable: boolean;
  lyricsPrefixes?: LyricsPrefixes | null;
}) {
  const isMobile = useIsMobile();
  const inset = useKeyboardInset();
  const editorFocused = useEditorFocus({ includeEditorUI: true }, editor);
  const [barFocused, setBarFocused] = useState(false);

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const styles = current.getActiveStyles();
      let isChecklist: boolean;
      try {
        isChecklist =
          current.getTextCursorPosition().block.type === "checkListItem";
      } catch {
        isChecklist = false;
      }
      const history = current.getExtension("history") as
        { undoCommand?: Command; redoCommand?: Command } | undefined;
      return {
        bold: Boolean(styles.bold),
        italic: Boolean(styles.italic),
        isChecklist,
        canUndo: history?.undoCommand
          ? current.canExec(history.undoCommand)
          : true,
        canRedo: history?.redoCommand
          ? current.canExec(history.redoCommand)
          : true,
      };
    },
  });

  if (
    !isMobile ||
    !editable ||
    (!editorFocused && !barFocused && inset === 0)
  ) {
    return null;
  }
  if (typeof document === "undefined") return null;

  const vvInset =
    typeof window !== "undefined" && window.visualViewport
      ? keyboardInset(window.innerHeight, window.visualViewport)
      : 0;

  const hasSection = "section" in editor.schema.blockSpecs;
  const hasChecklist = "checkListItem" in editor.schema.blockSpecs;
  const rhymePrefix = lyricsPrefixes?.rhyme ?? null;
  const synonymPrefix = lyricsPrefixes?.synonym ?? null;

  const insertSection = () => {
    const { block } = editor.getTextCursorPosition();
    if (block.type === "paragraph" && isBlockEmpty(block)) {
      editor.updateBlock(block, { type: "section" } as PartialBlock<B, I, S>);
      editor.setTextCursorPosition(block.id, "end");
    } else {
      const [inserted] = editor.insertBlocks(
        [{ type: "section" } as PartialBlock<B, I, S>],
        block,
        "after"
      );
      if (inserted) editor.setTextCursorPosition(inserted.id, "start");
    }
    editor.focus();
  };

  const toggleChecklist = () => {
    const { block } = editor.getTextCursorPosition();
    editor.updateBlock(block, {
      type: block.type === "checkListItem" ? "paragraph" : "checkListItem",
    } as PartialBlock<B, I, S>);
    editor.focus();
  };

  const toggleStyle = (style: "bold" | "italic") => {
    editor.toggleStyles({ [style]: true } as Styles<S>);
    editor.focus();
  };

  const openLookup = (prefix: string) => {
    editor.getExtension(SuggestionMenu)?.openSuggestionMenu(prefix, {
      deleteTriggerCharacter: true,
      ignoreQueryLength: true,
    });
  };

  const undo = () => {
    editor.undo();
    editor.focus();
  };

  const redo = () => {
    editor.redo();
    editor.focus();
  };

  return createPortal(
    <div
      data-slot="editor-accessory-bar"
      role="toolbar"
      aria-label="Lyrics and formatting"
      onFocusCapture={() => setBarFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setBarFocused(false);
        }
      }}
      style={{
        bottom: vvInset > 0 ? `${vvInset}px` : "var(--dock, 0px)",
      }}
      className="fixed inset-x-0 z-40 flex scrollbar-none items-center gap-0.5 overflow-x-auto border-t border-rule bg-paper/95 px-2 py-0.5 backdrop-blur-sm md:hidden"
    >
      {hasSection && (
        <AccessoryTextButton
          label="Section"
          ariaLabel="Add section"
          icon={<IconPlus className="size-3.5" aria-hidden />}
          onClick={insertSection}
        />
      )}
      {rhymePrefix !== null && (
        <AccessoryTextButton
          label="Rhymes"
          onClick={() => openLookup(rhymePrefix)}
        />
      )}
      {synonymPrefix !== null && (
        <AccessoryTextButton
          label="Synonyms"
          onClick={() => openLookup(synonymPrefix)}
        />
      )}
      {hasChecklist && (
        <button
          type="button"
          aria-label="Checklist"
          aria-pressed={state.isChecklist}
          onMouseDown={keepEditorFocus}
          onClick={toggleChecklist}
          className={BAR_BUTTON}
        >
          <IconListCheck className="size-4" aria-hidden />
        </button>
      )}
      <button
        type="button"
        aria-label="Bold"
        aria-pressed={state.bold}
        onMouseDown={keepEditorFocus}
        onClick={() => toggleStyle("bold")}
        className={BAR_BUTTON}
      >
        <IconBold className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Italic"
        aria-pressed={state.italic}
        onMouseDown={keepEditorFocus}
        onClick={() => toggleStyle("italic")}
        className={BAR_BUTTON}
      >
        <IconItalic className="size-4" aria-hidden />
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          aria-label="Undo"
          disabled={!state.canUndo}
          onMouseDown={keepEditorFocus}
          onClick={undo}
          className={BAR_BUTTON}
        >
          <IconArrowBackUp className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Redo"
          disabled={!state.canRedo}
          onMouseDown={keepEditorFocus}
          onClick={redo}
          className={BAR_BUTTON}
        >
          <IconArrowForwardUp className="size-4" aria-hidden />
        </button>
      </div>
    </div>,
    document.body
  );
}

function AccessoryTextButton({
  label,
  ariaLabel,
  icon,
  onClick,
}: {
  label: string;
  ariaLabel?: string;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onMouseDown={keepEditorFocus}
      onClick={onClick}
      className={cn(
        BAR_BUTTON,
        "px-2.5 font-sub text-micro tracking-[0.08em] uppercase"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
