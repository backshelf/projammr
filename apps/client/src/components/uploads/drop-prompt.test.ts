import { describe, expect, test } from "bun:test";
import { dropPromptFor } from "@/components/uploads/drop-prompt";

describe("dropPromptFor", () => {
  test("names what a track drop zone expects", () => {
    expect(dropPromptFor("track")).toBe("Drop a bounce, stems or a reference");
  });

  test("names what a session drop zone expects", () => {
    expect(dropPromptFor("session")).toBe(
      "Drop a bounce or an export from this session"
    );
  });

  test("names what a collection drop zone expects", () => {
    expect(dropPromptFor("collection")).toBe(
      "Drop artwork proofs, masters or a tracklist"
    );
  });

  test("keeps the generic prompt for a project drop zone", () => {
    expect(dropPromptFor("project")).toBe("Drop files here");
  });

  test("falls back to the generic prompt when no attachTo is passed", () => {
    expect(dropPromptFor(undefined)).toBe("Drop files here");
  });
});
