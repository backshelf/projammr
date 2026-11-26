import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, jest, mock } from "bun:test";
import { use } from "react";

// A write here is never sent: the clock is frozen for the 300 ms it waits.
mock.module("@/lib/browser-api", () => ({
  browserApi: { GET: mock(), PATCH: mock() },
}));

const { LyricsContext } =
  await import("@workspace/ui/components/block-editor/lyrics/context");
const { LyricsProvider } = await import("./LyricsProvider");
const { SettingsProvider, useSettingsWrite } =
  await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");
const { browserLyricsDictionary } = await import("@/lib/lyrics-dictionary");

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

/** What the lyrics editor reads from its context. */
function Editor() {
  const lyrics = use(LyricsContext);
  return (
    <span data-testid="prefixes">
      {lyrics
        ? `${lyrics.prefixes.rhyme} ${lyrics.prefixes.synonym} ${lyrics.dictionary === browserLyricsDictionary}`
        : "none"}
    </span>
  );
}

const writes: ReturnType<typeof useSettingsWrite>[] = [];
function CaptureWrite() {
  writes.push(useSettingsWrite());
  return null;
}

const mount = () =>
  render(
    <SettingsProvider
      initial={effectiveSettings(
        { "editor.rhymePrefix": "!", "editor.synonymPrefix": "=" },
        "v1"
      )}
    >
      <LyricsProvider>
        <Editor />
      </LyricsProvider>
      <CaptureWrite />
    </SettingsProvider>
  );

describe("LyricsProvider", () => {
  it("hands the editor the dictionary and the caller's own prefixes", () => {
    mount();

    expect(screen.getByTestId("prefixes").textContent).toBe("! = true");
  });

  it("follows a change to a prefix setting", () => {
    jest.useFakeTimers();
    mount();

    act(() => {
      void writes
        .at(-1)!
        .write("user", "u1", { "editor.rhymePrefix": "#" })
        .catch(() => {});
    });

    expect(screen.getByTestId("prefixes").textContent).toBe("# = true");
  });

  it("supplies nothing to an editor mounted without it", () => {
    render(<Editor />);

    expect(screen.getByTestId("prefixes").textContent).toBe("none");
  });

  it("hands down a null prefix for a suggestion type turned off", () => {
    render(
      <SettingsProvider
        initial={effectiveSettings(
          {
            "editor.rhymePrefix": "!",
            "editor.synonymPrefix": "=",
            "editor.rhymeSuggestions": false,
            "editor.synonymSuggestions": false,
          },
          "v1"
        )}
      >
        <LyricsProvider>
          <Editor />
        </LyricsProvider>
      </SettingsProvider>
    );

    expect(screen.getByTestId("prefixes").textContent).toBe("null null true");
  });
});
