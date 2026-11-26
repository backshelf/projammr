import { defineCommands, defineScope } from "@/components/commands/define";

/**
 * What the notebook list's push attaches, each null while the list gives the
 * key nothing to act on. Pushed while the list is mounted.
 */
export type NotebookSurface = {
  /** Opens the next or previous note in the list's visible order. */
  step: ((delta: 1 | -1) => void) | null;
  /** Focuses the filter input. */
  focusFilter: (() => void) | null;
};

export const NOTEBOOK_SCOPE = defineScope<NotebookSurface>("notebook");

/**
 * What the open note's push attaches, each null while the note's rights or
 * saved state do not allow it. Pushed by the notebook's editor only: on a
 * track page the same editor sits under the track's own keys.
 */
export type NoteSurface = {
  /** Copies the note's text. */
  copy: (() => void) | null;
  /** Opens the dialog that links the note to a track. */
  link: (() => void) | null;
};

export const NOTE_SCOPE = defineScope<NoteSurface>("note");

/** The notebook's list and open note. */
export const NOTEBOOK_COMMANDS = [
  ...defineCommands(NOTEBOOK_SCOPE, [
    {
      id: "next-note",
      label: "Next note",
      group: "Notebook",
      keys: ["j"],
      when: (ctx) => ctx.surface.step !== null,
      run: (ctx) => ctx.surface.step?.(1),
    },
    {
      id: "previous-note",
      label: "Previous note",
      group: "Notebook",
      keys: ["k"],
      when: (ctx) => ctx.surface.step !== null,
      run: (ctx) => ctx.surface.step?.(-1),
    },
    {
      id: "focus-note-filter",
      label: "Filter notes",
      group: "Notebook",
      keys: ["f"],
      when: (ctx) => ctx.surface.focusFilter !== null,
      run: (ctx) => ctx.surface.focusFilter?.(),
    },
  ]),
  ...defineCommands(NOTE_SCOPE, [
    {
      id: "copy-note",
      label: "Copy note as plain text",
      group: "Notebook",
      keys: ["y"],
      when: (ctx) => ctx.surface.copy !== null,
      run: (ctx) => ctx.surface.copy?.(),
    },
    {
      id: "link-note",
      label: "Link note to a track",
      group: "Notebook",
      keys: ["t"],
      when: (ctx) => ctx.surface.link !== null,
      run: (ctx) => ctx.surface.link?.(),
    },
  ]),
];
