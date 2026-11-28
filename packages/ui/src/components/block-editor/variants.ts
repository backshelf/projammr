import * as React from "react";

export type EditorVariant = "document" | "lyrics" | "plain";

/** What every editor variant is handed. `BlockEditorProps` adds the variant. */
export type VariantProps = {
  value?: string;
  onChange?: (json: string) => void;
  editable?: boolean;
  placeholder?: string;
  /** Accessible name for the editor's `role="textbox"` surface. Defaults to `"Document editor"`. */
  ariaLabel?: string;
  /**
   * Editor colour scheme. Without this, BlockNoteView falls back to the OS
   * `prefers-color-scheme`, which forces `.bn-root.dark` even when the app is
   * in light mode — that pulls in the dark custom-property block and breaks
   * accent-coloured chrome like the checklist boxes.
   */
  theme?: "light" | "dark";
};

const DEFAULT_EDITOR_ARIA_LABEL = "Document editor";

export function editorDomAttributes(ariaLabel?: string) {
  return {
    editor: {
      "aria-label": ariaLabel?.trim() || DEFAULT_EDITOR_ARIA_LABEL,
    },
  };
}

/**
 * The variant a surface asks for decides which editor component is mounted.
 * A BlockNote editor's schema is fixed when it is created, so a variant can
 * never be a switch inside a mounted editor. Lazy entries also keep each
 * variant's schema, plugins and menus out of the other variants' bundles.
 */
export const EDITOR_VARIANTS: Record<
  EditorVariant,
  React.LazyExoticComponent<React.ComponentType<VariantProps>>
> = {
  document: React.lazy(() => import("./document")),
  lyrics: React.lazy(() => import("./lyrics")),
  plain: React.lazy(() => import("./plain")),
};
