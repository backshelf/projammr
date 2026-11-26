"use client";

import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import {
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from "@blocknote/react";
import { IconSection } from "@tabler/icons-react";
import type { LyricsEditor } from "./schema";

/** BlockNote's own slash-menu items, plus one for the section block. */
export const lyricsSlashMenuItems = (
  editor: LyricsEditor
): DefaultReactSuggestionItem[] => [
  ...getDefaultReactSlashMenuItems(editor),
  {
    title: "Section",
    subtext: "Name a verse, chorus or bridge",
    aliases: ["section", "verse", "chorus", "bridge", "hook"],
    group: editor.dictionary.slash_menu.heading.group,
    icon: <IconSection size={18} />,
    onItemClick: () => {
      insertOrUpdateBlockForSlashMenu(editor, { type: "section" });
    },
  },
];
