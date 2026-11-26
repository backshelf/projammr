import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { AssetWithContext } from "@workspace/api/api";

import "./test-support";

// `test-support` stubs the router, the copy dialog and the hotkey registry
// before the table is imported, so the table loads after it. The row actions
// need the music player and a download dialog, which are not what this suite
// is about.
mock.module("./AssetRowActions", () => ({ AssetRowActions: () => null }));

const { AssetsTable } = await import("./AssetsTable");

const PAGE = 50;

function assetsOf(count: number, from = 1) {
  return Array.from({ length: count }, (_, index) => ({
    id: from + index,
    name: `take-${from + index}.wav`,
    size: 2048,
    createdAt: "2026-01-01T00:00:00.000Z",
    uploadedBy: null,
    attachments: [],
  })) as unknown as AssetWithContext[];
}

// happy-dom starts on about:blank, where `history.replaceState` is ignored, so
// the location is set through the window's own controller.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;

function locate(search: string) {
  happyDOM.setURL(`http://localhost/project/1/tracks${search}`);
}

afterEach(() => happyDOM.setURL(START_URL));

/** Renders, then lets the table adopt the URL once it has hydrated. */
async function renderAssets(assets: AssetWithContext[], rowCount: number) {
  const result = render(
    <AssetsTable assets={assets} rowCount={rowCount} projectId={1} />
  );
  await act(async () => {});
  return result;
}

describe("AssetsTable", () => {
  it("renders each file's name and its size", async () => {
    locate("");
    await renderAssets(assetsOf(2), 2);

    expect(screen.getByText("take-1.wav")).toBeTruthy();
    expect(screen.getByText("take-2.wav")).toBeTruthy();
    expect(screen.getAllByText("2 KB")).toHaveLength(2);
  });

  it("composes the toolbar, grid, selection and paging", async () => {
    locate("");
    await renderAssets(assetsOf(2), 2);

    // The desktop and phone toolbars each carry the search box.
    expect(screen.getAllByLabelText("Search the table")).not.toHaveLength(0);
    expect(screen.getByRole("grid")).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "Select all loaded rows" })
    ).toBeTruthy();
    expect(screen.getByText("2 rows")).toBeTruthy();
  });

  it("counts the server's total rather than the rows loaded", async () => {
    locate("");
    await renderAssets(assetsOf(PAGE), 60);

    expect(screen.getByText("60 rows")).toBeTruthy();
  });
});
