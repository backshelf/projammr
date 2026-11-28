import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { BlockEditor } from "./index";
import { editorDomAttributes } from "./variants";

afterEach(() => {
  cleanup();
});

describe("editorDomAttributes", () => {
  it("falls back to a default accessible name when ariaLabel is omitted or blank", () => {
    expect(editorDomAttributes()).toEqual({
      editor: { "aria-label": "Document editor" },
    });
    expect(editorDomAttributes("")).toEqual({
      editor: { "aria-label": "Document editor" },
    });
    expect(editorDomAttributes("   ")).toEqual({
      editor: { "aria-label": "Document editor" },
    });
  });

  it("preserves an explicit ariaLabel", () => {
    expect(editorDomAttributes("Note editor")).toEqual({
      editor: { "aria-label": "Note editor" },
    });
  });
});

describe("BlockEditor", () => {
  it("gives the rendered role='textbox' element a default aria-label", async () => {
    render(<BlockEditor variant="document" />);
    const textbox = await screen.findByRole(
      "textbox",
      {
        name: "Document editor",
      },
      { timeout: 5000 },
    );
    expect(textbox.getAttribute("aria-label")).toBe("Document editor");
    expect(textbox.classList.contains("tiptap")).toBe(true);
  });

  it("applies a custom ariaLabel across plain and lyrics variants", async () => {
    render(<BlockEditor variant="plain" ariaLabel="Note editor" />);
    const plainBox = await screen.findByRole(
      "textbox",
      {
        name: "Note editor",
      },
      { timeout: 5000 },
    );
    expect(plainBox.getAttribute("aria-label")).toBe("Note editor");

    cleanup();
    render(<BlockEditor variant="lyrics" ariaLabel="Lyrics editor" />);
    const lyricsBox = await screen.findByRole(
      "textbox",
      {
        name: "Lyrics editor",
      },
      { timeout: 5000 },
    );
    expect(lyricsBox.getAttribute("aria-label")).toBe("Lyrics editor");
  });
});
