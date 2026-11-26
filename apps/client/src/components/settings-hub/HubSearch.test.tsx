import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { SETTINGS } from "@workspace/settings";
import { useState, type ComponentProps } from "react";

type Result = { data?: unknown; error?: unknown; response: Response };
const GET = mock<(path: string, init: unknown) => Promise<Result>>();
mock.module("@/lib/browser-api", () => ({ browserApi: { GET } }));

// Next's link prefetches as it mounts, which only adds noise here.
mock.module("next/link", () => ({
  __esModule: true,
  default: ({ href, className, children }: ComponentProps<"a">) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
  // Not a real hook, just a stub matching the shape `next/link` exports.
  useLinkStatus: () => ({ pending: false }),
}));

const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");
const { HubRowsProvider } = await import("./hub-rows");
const { HubSearchField, HubSearchResults } = await import("./HubSearch");
const { hubLayout } = await import("./layout");
const { searchSettings } = await import("./search");

const everyKey = new Set(Object.keys(SETTINGS));

/** A member's index: Personal only. */
const memberIndex = hubLayout({
  visible: everyKey,
  isAdmin: false,
  project: null,
  panes: [],
}).index;

/** An instance admin's index: Personal, then Instance with its member defaults. */
const adminIndex = hubLayout({
  visible: everyKey,
  isAdmin: true,
  project: null,
  panes: [],
}).index;

const rows = Object.fromEntries(
  Object.values(SETTINGS).map((definition) => [
    definition.key,
    {
      effective: definition.default,
      source: "default",
      writable: { user: true, instance: true },
      lockable: { user: false, instance: true },
      values: {},
    },
  ])
);

function results(query: string, index = memberIndex, onClear = () => {}) {
  return render(
    <SettingsProvider initial={effectiveSettings({}, "v1")}>
      <HubRowsProvider initial={rows} projectId={null} userId="u1">
        <HubSearchResults index={index} query={query} onClear={onClear} />
      </HubRowsProvider>
    </SettingsProvider>
  );
}

/** The line that counts the matches (each row has a status of its own). */
const summary = () =>
  document.querySelector('p[role="status"]')?.textContent ?? "";

const shownLabels = () =>
  screen
    .queryAllByRole("textbox")
    .map((input) => input.getAttribute("id"))
    .map((id) => document.querySelector(`label[for="${id}"]`)?.textContent);

afterEach(cleanup);

describe("HubSearchResults", () => {
  it("finds a setting by its label", () => {
    results("rhyme");

    // Only one match is a text control ("Rhyme prefix"); the toggles
    // "Rhyme suggestions" and "Rhyme letters" also match the query and count
    // toward the summary, but render as switches, not textboxes.
    expect(shownLabels()).toEqual(["Rhyme prefix"]);
    expect(summary()).toBe("3 settings match “rhyme”");
  });

  it("finds a setting by its description", () => {
    results("synonym menu");

    expect(shownLabels()).toEqual(["Synonym prefix"]);
  });

  it("finds a setting by a keyword", () => {
    results("THESAURUS");

    expect(shownLabels()).toEqual(["Synonym prefix"]);
  });

  it("needs every word of the query to match", () => {
    results("lyrics trigger");
    expect(shownLabels()).toEqual(["Rhyme prefix", "Synonym prefix"]);
    cleanup();

    results("rhyme thesaurus");
    expect(shownLabels()).toEqual([]);
  });

  it("finds a setting in every section the caller can open, under its group and section", () => {
    results("rhyme prefix", adminIndex);

    const found = screen.getAllByRole("region");
    expect(found.map((region) => region.getAttribute("aria-label"))).toEqual([
      "Editor, Personal",
      "Member defaults, Instance",
    ]);
    expect(shownLabels()).toEqual(["Rhyme prefix", "Rhyme prefix"]);
    expect(
      screen.getByRole("link", { name: "Instance" }).getAttribute("href")
    ).toBe("/settings/instance/member-defaults");
  });

  it("says when nothing matches, and offers to clear the search", () => {
    const onClear = mock();
    // A query no real setting's label, description or keywords contain, so
    // the assertion holds regardless of what the registry grows to include.
    results("zzznonexistentzzz", memberIndex, onClear);

    expect(summary()).toBe("No settings match “zzznonexistentzzz”");
    expect(shownLabels()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Clear the search" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("searchSettings", () => {
  it("matches nothing for a query with no words", () => {
    expect(searchSettings(memberIndex, "   ")).toEqual([]);
  });
});

describe("HubSearchField", () => {
  function Field() {
    const [value, setValue] = useState("rhyme");
    return <HubSearchField value={value} onChange={setValue} />;
  }

  it("clears on Escape", () => {
    render(<Field />);
    const box = screen.getByRole("searchbox", { name: "Search settings" });

    fireEvent.keyDown(box, { key: "Escape" });

    expect((box as HTMLInputElement).value).toBe("");
  });
});
