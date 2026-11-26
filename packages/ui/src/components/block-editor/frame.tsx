"use client";

import "@blocknote/react/style.css";
import "@blocknote/shadcn/style.css";
import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from "@blocknote/core";
import { BlockNoteView } from "@blocknote/shadcn";
import type { ReactNode } from "react";

export type EditorFrameProps<
  B extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
> = {
  editor: BlockNoteEditor<B, I, S>;
  editable?: boolean;
  theme?: "light" | "dark";
  /** Off for a variant that mounts its own slash-menu controller, whose items
   * come from that variant's schema rather than BlockNote's defaults. */
  slashMenu?: boolean;
  /** Controllers a variant mounts alongside the editor — suggestion menus. */
  children?: ReactNode;
};

/** The bare editor surface: BlockNote's own chrome off, page styling on. */
export function EditorFrame<
  B extends BlockSchema,
  I extends InlineContentSchema,
  S extends StyleSchema,
>({
  editor,
  editable = true,
  theme,
  slashMenu = true,
  children,
}: EditorFrameProps<B, I, S>) {
  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={theme}
      slashMenu={slashMenu}
      formattingToolbar={false}
      linkToolbar={false}
      filePanel={false}
      sideMenu={false}
      tableHandles={false}
      className={
        "h-full bg-transparent p-0 text-primary [&_.ProseMirror]:!bg-transparent [&_.bn-container]:!bg-transparent [&_.bn-editor]:!bg-transparent [&_.bn-editor]:!px-0"
      }
    >
      {children}
    </BlockNoteView>
  );
}
