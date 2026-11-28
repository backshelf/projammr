import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from "@blocknote/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

let mobile = true;
let keyboardInsetValue = 0;
let editorFocused = true;
let activeStyles: Record<string, boolean> = {};
let cursorBlock = {
  id: "b1",
  type: "paragraph",
  content: [] as Array<{ type: string; text?: string }>,
};
let canUndo = true;
let canRedo = false;

mock.module("@workspace/ui/hooks/use-mobile", () => ({
  useIsMobile: () => mobile,
}));
mock.module("@workspace/ui/hooks/use-keyboard-inset", () => ({
  keyboardInset: (
    layoutHeight: number,
    visual: { height: number; offsetTop: number }
  ) =>
    Math.max(0, Math.round(layoutHeight - (visual.height + visual.offsetTop))),
  useKeyboardInset: () => keyboardInsetValue,
}));
import * as blocknoteReact from "@blocknote/react";

type AnyEditor = BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>;

mock.module("@blocknote/react", () => ({
  ...blocknoteReact,
  useEditorFocus: () => editorFocused,
  useEditorState: ({
    selector,
    editor,
  }: {
    selector: (ctx: { editor: AnyEditor }) => unknown;
    editor: AnyEditor;
  }) => selector({ editor }),
}));

const { EditorAccessoryBar } = await import("./accessory-bar");

function makeEditor() {
  const openSuggestionMenu = mock();
  const editor = {
    schema: {
      blockSpecs: {
        paragraph: {},
        checkListItem: {},
        section: {},
      },
    },
    getActiveStyles: () => activeStyles,
    getTextCursorPosition: () => ({ block: cursorBlock }),
    getExtension: (ext: unknown) => {
      if (ext === "history") {
        return {
          undoCommand: () => canUndo,
          redoCommand: () => canRedo,
        };
      }
      return { openSuggestionMenu };
    },
    canExec: (cmd: () => boolean) => cmd(),
    updateBlock: mock(),
    insertBlocks: mock(() => [{ id: "b2" }]),
    setTextCursorPosition: mock(),
    toggleStyles: mock(),
    undo: mock(),
    redo: mock(),
    focus: mock(),
  } as unknown as AnyEditor & {
    updateBlock: ReturnType<typeof mock>;
    insertBlocks: ReturnType<typeof mock>;
    setTextCursorPosition: ReturnType<typeof mock>;
    toggleStyles: ReturnType<typeof mock>;
    undo: ReturnType<typeof mock>;
    redo: ReturnType<typeof mock>;
    focus: ReturnType<typeof mock>;
  };
  return { editor, openSuggestionMenu };
}

afterEach(() => {
  cleanup();
  mobile = true;
  keyboardInsetValue = 0;
  editorFocused = true;
  activeStyles = {};
  cursorBlock = { id: "b1", type: "paragraph", content: [] };
  canUndo = true;
  canRedo = false;
});

describe("EditorAccessoryBar", () => {
  it("renders nothing on desktop or when read-only or unfocused without keyboard", () => {
    const { editor } = makeEditor();

    mobile = false;
    const { rerender } = render(
      <EditorAccessoryBar
        editor={editor}
        editable
        lyricsPrefixes={{ rhyme: "~", synonym: "@" }}
      />
    );
    expect(screen.queryByRole("toolbar")).toBeNull();

    mobile = true;
    rerender(
      <EditorAccessoryBar
        editor={editor}
        editable={false}
        lyricsPrefixes={{ rhyme: "~", synonym: "@" }}
      />
    );
    expect(screen.queryByRole("toolbar")).toBeNull();

    editorFocused = false;
    keyboardInsetValue = 0;
    rerender(
      <EditorAccessoryBar
        editor={editor}
        editable
        lyricsPrefixes={{ rhyme: "~", synonym: "@" }}
      />
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("renders all lyrics and formatting actions on mobile and triggers editor commands", () => {
    const { editor, openSuggestionMenu } = makeEditor();
    activeStyles = { bold: true };
    render(
      <EditorAccessoryBar
        editor={editor}
        editable
        lyricsPrefixes={{ rhyme: "~", synonym: "@" }}
      />
    );

    const toolbar = screen.getByRole("toolbar", {
      name: "Lyrics and formatting",
    });
    expect(toolbar.style.bottom).toBe("var(--dock, 0px)");

    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(editor.updateBlock).toHaveBeenCalledWith(cursorBlock, {
      type: "section",
    });

    fireEvent.click(screen.getByRole("button", { name: "Rhymes" }));
    expect(openSuggestionMenu).toHaveBeenCalledWith("~", {
      deleteTriggerCharacter: true,
      ignoreQueryLength: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Synonyms" }));
    expect(openSuggestionMenu).toHaveBeenCalledWith("@", {
      deleteTriggerCharacter: true,
      ignoreQueryLength: true,
    });

    fireEvent.click(screen.getByRole("button", { name: "Checklist" }));
    expect(editor.updateBlock).toHaveBeenCalledWith(cursorBlock, {
      type: "checkListItem",
    });

    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(bold);
    expect(editor.toggleStyles).toHaveBeenCalledWith({ bold: true });

    const italic = screen.getByRole("button", { name: "Italic" });
    expect(italic.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(italic);
    expect(editor.toggleStyles).toHaveBeenCalledWith({ italic: true });

    const undo = screen.getByRole("button", {
      name: "Undo",
    }) as HTMLButtonElement;
    const redo = screen.getByRole("button", {
      name: "Redo",
    }) as HTMLButtonElement;
    expect(undo.disabled).toBe(false);
    expect(redo.disabled).toBe(true);
    fireEvent.click(undo);
    expect(editor.undo).toHaveBeenCalledTimes(1);
  });

  it("inserts a new section after a non-empty block", () => {
    const { editor } = makeEditor();
    cursorBlock = {
      id: "b1",
      type: "paragraph",
      content: [{ type: "text", text: "Existing lyric" }],
    };

    render(<EditorAccessoryBar editor={editor} editable />);
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));

    expect(editor.insertBlocks).toHaveBeenCalledWith(
      [{ type: "section" }],
      cursorBlock,
      "after"
    );
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith("b2", "start");
  });

  it("pins directly above iOS visualViewport keyboard inset when present", () => {
    const { editor } = makeEditor();
    const originalVV = window.visualViewport;
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 844,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { height: 544, offsetTop: 0 },
    });
    keyboardInsetValue = 300;

    try {
      render(<EditorAccessoryBar editor={editor} editable />);
      const toolbar = screen.getByRole("toolbar");
      expect(toolbar.style.bottom).toBe("300px");
    } finally {
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalHeight,
      });
      Object.defineProperty(window, "visualViewport", {
        configurable: true,
        value: originalVV,
      });
    }
  });
});
