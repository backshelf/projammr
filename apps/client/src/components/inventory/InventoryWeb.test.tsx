import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import type { InventoryWeb as Web } from "@/lib/inventory-web";
import type { ConstellationData } from "@workspace/ui/lib/constellation";

// The renderer needs WebGL, which a test has not got: the stand-in shows what
// the web was handed.
mock.module("next/dynamic", () => ({
  default:
    () =>
    ({
      data,
      label,
      highlight,
    }: {
      data: ConstellationData;
      label: string;
      highlight: string;
    }) => (
      <div
        data-testid="web"
        data-label={label}
        data-highlight={highlight}
        data-nodes={data.nodes.length}
      />
    ),
}));

const { InventoryWeb } = await import("./InventoryWeb");
const { InventorySearchProvider } = await import("./inventory-search-context");

afterEach(cleanup);

const WEB: ConstellationData = {
  nodes: [
    {
      id: "set:1",
      label: "Invented Set A",
      count: "1 device",
      shape: "circle",
      x: 0,
      y: 0,
      size: 2.5,
    },
    {
      id: "item:Verb",
      label: "Verb",
      count: "in 1 set",
      shape: "square",
      x: 10,
      y: 0,
      size: 2.5,
    },
  ],
  edges: [[0, 1, 1, 1]],
  key: "k",
};

const STOCK: Web["stock"] = [
  {
    id: "Echo",
    label: "Echo",
    sets: 20,
    href: "/project/7/plugins?device=Echo",
  },
  {
    id: "Glue",
    label: "Glue",
    sets: 1,
    href: "/project/7/plugins?device=Glue",
  },
];

async function renderWeb(result: Web, stock = false) {
  const element = await InventoryWeb({
    layout: () => Promise.resolve(result),
    label: "2 devices across 1 set",
    stock,
    toggleHref: stock ? "/project/7/plugins" : "/project/7/plugins?stock=1",
  });
  return render(<InventorySearchProvider>{element}</InventorySearchProvider>);
}

describe("InventoryWeb", () => {
  test("hands the web its drawing, the page's lede as its name and the search", async () => {
    await renderWeb({ web: WEB, stock: [] });

    const web = screen.getByTestId("web");
    expect(web.getAttribute("data-nodes")).toBe("2");
    expect(web.getAttribute("data-label")).toBe("2 devices across 1 set");
    expect(web.getAttribute("data-highlight")).toBe("");
    expect(screen.queryByText("Stock chain")).toBeNull();
  });

  test("lists the stock chain under the web as chips to each row, with the control to draw it", async () => {
    await renderWeb({ web: WEB, stock: STOCK });

    const echo = screen.getByRole("link", { name: "Echo · 20 sets" });
    expect(echo.getAttribute("href")).toBe("/project/7/plugins?device=Echo");
    expect(screen.getByRole("link", { name: "Glue · 1 set" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Show stock chain" })
        .getAttribute("href")
    ).toBe("/project/7/plugins?stock=1");
  });

  test("offers to hide the stock chain once it is drawn", async () => {
    await renderWeb({ web: WEB, stock: STOCK }, true);

    expect(
      screen
        .getByRole("link", { name: "Hide stock chain" })
        .getAttribute("href")
    ).toBe("/project/7/plugins");
  });

  test("shows only the strip when everything the page lists is stock chain", async () => {
    await renderWeb({
      web: { nodes: [], edges: [], key: "empty" },
      stock: STOCK,
    });

    expect(screen.queryByTestId("web")).toBeNull();
    expect(screen.getByText("Stock chain")).toBeTruthy();
  });

  test("renders nothing with nothing to draw or list", async () => {
    const { container } = await renderWeb({
      web: { nodes: [], edges: [], key: "empty" },
      stock: [],
    });

    expect(container.textContent).toBe("");
  });
});
