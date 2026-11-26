import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { stubGlobal } from "@workspace/test/globals";
import type { ConstellationData } from "@workspace/ui/lib/constellation";
import { useEffect, type Ref } from "react";

// happy-dom has no WebGL and no 2D canvas: the stand-in says WebGL is there,
// and paints every colour black, which is all the palette needs to resolve.
// The renderer reads WebGL's constants as it loads.
stubGlobal("WebGLRenderingContext", { FLOAT: 0x1406 });
stubGlobal("WebGL2RenderingContext", { FLOAT: 0x1406 });
HTMLCanvasElement.prototype.getContext = function (kind: string) {
  if (kind !== "2d") return {};
  return {
    fillStyle: "",
    clearRect() {},
    fillRect() {},
    getImageData: () => ({ data: [0, 0, 0, 255] }),
  };
} as unknown as HTMLCanvasElement["getContext"];

let reducedMotion = false;
const motion = await import("@workspace/ui/lib/motion");
mock.module("@workspace/ui/lib/motion", () => ({
  ...motion,
  useReducedMotion: () => reducedMotion,
}));

type Handler = (payload: unknown) => void;

/** The renderer, scripted: it records what the component asks of it and lets
 *  a test fire the events a pointer would. */
class FakeSigma {
  handlers = new Map<string, Set<Handler>>();
  settings: Record<string, unknown> = {};
  refreshes = 0;
  canvas = document.createElement("canvas");
  mouse = { isMouseDown: false };
  camera = {
    handlers: new Map<string, Set<Handler>>(),
    state: { x: 0.5, y: 0.5, ratio: 1, angle: 0 },
    on(event: string, handler: Handler) {
      const set = this.handlers.get(event) ?? new Set();
      set.add(handler);
      this.handlers.set(event, set);
    },
    off(event: string, handler: Handler) {
      this.handlers.get(event)?.delete(handler);
    },
    emit(event: string) {
      for (const handler of this.handlers.get(event) ?? []) handler({});
    },
    getState() {
      return this.state;
    },
    animate: mock(() => Promise.resolve()),
    animatedZoom: mock(() => Promise.resolve()),
    animatedUnzoom: mock(() => Promise.resolve()),
    animatedReset: mock(() => Promise.resolve()),
  };

  on(event: string, handler: Handler) {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }
  off(event: string, handler: Handler) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event: string, payload: unknown = {}) {
    act(() => {
      for (const handler of this.handlers.get(event) ?? []) handler(payload);
    });
  }
  setSettings(settings: Record<string, unknown>) {
    Object.assign(this.settings, settings);
  }
  refresh() {
    this.refreshes += 1;
  }
  getCamera() {
    return this.camera;
  }
  getMouseCaptor() {
    return this.mouse;
  }
  getCanvases() {
    return { edges: this.canvas };
  }
  getNodeDisplayData(key: string) {
    return { x: Number(key) / 10, y: 0.5, size: 3 };
  }
  framedGraphToViewport(point: { x: number; y: number }) {
    return { x: point.x * 1000, y: point.y * 1000 };
  }
  scaleSize(size: number) {
    return size;
  }

  /** What the node reducer makes of a node, as the renderer would ask. */
  node(key: string) {
    const reducer = this.settings.nodeReducer as (
      key: string,
      data: object
    ) => Record<string, unknown>;
    return reducer(key, { label: `label ${key}` });
  }
  edge(key: string) {
    const reducer = this.settings.edgeReducer as (
      key: string,
      data: object
    ) => Record<string, unknown>;
    return reducer(key, {});
  }
}

let sigma = new FakeSigma();
const containerProps: { graph?: unknown }[] = [];

function FakeContainer({
  ref,
  graph,
}: {
  ref: Ref<FakeSigma | null>;
  graph: unknown;
}) {
  containerProps.push({ graph });
  useEffect(() => {
    if (typeof ref === "function") ref(sigma);
  }, [ref, graph]);
  return <div className="sigma-container" />;
}

mock.module("@react-sigma/core", () => ({ SigmaContainer: FakeContainer }));

const { Constellation } = await import("./constellation");

const DATA: ConstellationData = {
  nodes: [
    {
      id: "set:1",
      label: "Invented Set A",
      meta: "Harbour Lights",
      count: "2 devices",
      shape: "circle",
      x: 0,
      y: 0,
      size: 2.5,
      link: { label: "Open set", href: "/project/7/session/1" },
    },
    {
      id: "set:2",
      label: "Invented Set B",
      count: "1 device",
      shape: "circle",
      x: 10,
      y: 0,
      size: 2.5,
    },
    {
      id: "item:verb",
      label: "Glasshall Verb",
      meta: "Nimbus Audio · VST3",
      count: "in 2 sets",
      shape: "square",
      x: 5,
      y: 5,
      size: 4,
      link: { label: "Show row", href: "/project/7/plugins?device=Glasshall" },
    },
    {
      id: "item:comp",
      label: "Compressor",
      meta: "Built-in",
      count: "in 1 set",
      shape: "square",
      x: 0,
      y: 5,
      size: 3,
    },
  ],
  edges: [
    [0, 2, 0.6, 1],
    [1, 2, 0.6, 2],
    [0, 3, 1, 1],
  ],
  key: "web-1",
};

function renderWeb(highlight = "") {
  sigma = new FakeSigma();
  const result = render(
    <Constellation
      data={DATA}
      label="4 devices across 2 sets"
      highlight={highlight}
    />
  );
  return {
    ...result,
    canvas: result.getByRole("img", { name: "4 devices across 2 sets" }),
    search: (next: string) =>
      result.rerender(
        <Constellation
          data={DATA}
          label="4 devices across 2 sets"
          highlight={next}
        />
      ),
  };
}

const mouseOver = (node: string) =>
  sigma.emit("enterNode", {
    node,
    event: { original: new MouseEvent("mousemove") },
  });

const floatingNote = () =>
  document.body.querySelector<HTMLElement>("body > .fixed");
const popover = () =>
  document.body.querySelector<HTMLElement>('[data-slot="popover-content"]');

afterEach(() => {
  cleanup();
  reducedMotion = false;
  containerProps.length = 0;
});

describe("Constellation", () => {
  it("is a named image with the three camera buttons beside it", () => {
    const { getByRole } = renderWeb();

    fireEvent.click(getByRole("button", { name: "Zoom in" }));
    fireEvent.click(getByRole("button", { name: "Zoom out" }));
    fireEvent.click(getByRole("button", { name: "Fit the web" }));

    expect(sigma.camera.animatedZoom).toHaveBeenCalledTimes(1);
    expect(sigma.camera.animatedUnzoom).toHaveBeenCalledTimes(1);
    expect(sigma.camera.animatedReset).toHaveBeenCalledTimes(1);
  });

  it("hands the renderer the page's tokens, fonts and motion as settings", () => {
    renderWeb();

    expect(sigma.settings.nodeReducer).toBeFunction();
    expect(sigma.settings.edgeReducer).toBeFunction();
    expect(sigma.settings.zoomDuration).toBeGreaterThan(0);
    expect(sigma.node("0")).toMatchObject({ zIndex: 1 });
  });

  it("lights a hovered node, its edges and its neighbours, dims the rest, and shows its note", async () => {
    renderWeb();

    mouseOver("0");

    expect(sigma.node("0")).toMatchObject({ zIndex: 3, label: "" });
    expect(sigma.node("2")).toMatchObject({ zIndex: 2, forceLabel: true });
    expect(sigma.node("3")).toMatchObject({ zIndex: 2 });
    expect(sigma.node("1")).toMatchObject({ zIndex: 0, label: "" });
    expect(sigma.edge("0")).toMatchObject({ zIndex: 2 });
    expect(sigma.edge("1")).toMatchObject({ zIndex: 0 });

    const note = await waitFor(() => floatingNote()!);
    expect(note.textContent).toBe("Invented Set AHarbour Lights2 devices");
    // A hover's note is a glance: the link out waits for a pin.
    expect(note.querySelector("a")).toBeNull();

    sigma.emit("leaveNode", { node: "0" });
    expect(sigma.node("1")).toMatchObject({ zIndex: 1 });
  });

  it("ignores a touch passing over a node, and a node sliding under a drag", () => {
    renderWeb();

    sigma.emit("enterNode", {
      node: "0",
      event: { original: new TouchEvent("touchmove") },
    });
    expect(sigma.node("1")).toMatchObject({ zIndex: 1 });

    sigma.mouse.isMouseDown = true;
    mouseOver("0");
    expect(sigma.node("1")).toMatchObject({ zIndex: 1 });
  });

  it("pins on a click, with the node's link out in its note, and lets go on a second click", async () => {
    renderWeb();

    sigma.emit("clickNode", { node: "2" });
    const note = await waitFor(() => popover()!);
    expect(note.getAttribute("aria-label")).toBe("Glasshall Verb");
    expect(note.querySelector("a")?.getAttribute("href")).toBe(
      "/project/7/plugins?device=Glasshall"
    );
    expect(note.textContent).toContain("in 2 sets");

    // A pin outranks the hover.
    mouseOver("3");
    expect(sigma.node("1")).toMatchObject({ zIndex: 2 });

    sigma.emit("clickNode", { node: "2" });
    await waitFor(() => expect(popover()).toBeNull());
  });

  it("lets go of a pin on a click on empty paper, and on Escape", async () => {
    const { canvas } = renderWeb();

    sigma.emit("clickNode", { node: "0" });
    await waitFor(() => popover()!);
    sigma.emit("clickStage");
    expect(sigma.node("1")).toMatchObject({ zIndex: 1 });

    sigma.emit("clickNode", { node: "0" });
    fireEvent.keyDown(canvas, { key: "Escape" });
    expect(sigma.node("1")).toMatchObject({ zIndex: 1 });
  });

  it("drops the hover when the camera moves under the pointer", async () => {
    renderWeb();

    mouseOver("0");
    await waitFor(() => floatingNote()!);
    act(() => sigma.camera.emit("updated"));
    expect(sigma.node("1")).toMatchObject({ zIndex: 1 });

    // The next node the pointer reaches lights as usual.
    mouseOver("1");
    expect(sigma.node("1")).toMatchObject({ zIndex: 3 });
  });

  it("pans on the arrows, zooms on + and -, and fits on 0", () => {
    const { canvas } = renderWeb();

    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    expect(sigma.camera.animate).toHaveBeenLastCalledWith(
      { x: 0.6, y: 0.5 },
      { duration: 120 }
    );
    fireEvent.keyDown(canvas, { key: "ArrowUp" });
    expect(sigma.camera.animate).toHaveBeenLastCalledWith(
      { x: 0.5, y: 0.6 },
      { duration: 120 }
    );
    fireEvent.keyDown(canvas, { key: "+" });
    fireEvent.keyDown(canvas, { key: "-" });
    fireEvent.keyDown(canvas, { key: "0" });
    expect(sigma.camera.animatedZoom).toHaveBeenCalledTimes(1);
    expect(sigma.camera.animatedUnzoom).toHaveBeenCalledTimes(1);
    expect(sigma.camera.animatedReset).toHaveBeenCalledTimes(1);
  });

  it("moves the camera at once under reduced motion", () => {
    reducedMotion = true;
    const { canvas } = renderWeb();

    expect(sigma.settings.zoomDuration).toBe(0);
    expect(sigma.settings.inertiaDuration).toBe(0);
    fireEvent.keyDown(canvas, { key: "ArrowLeft" });
    expect(sigma.camera.animate).toHaveBeenLastCalledWith(
      { x: 0.4, y: 0.5 },
      { duration: 0 }
    );
  });

  it("lights the search's matches and frames them, and dims nothing when nothing matches", () => {
    const { search } = renderWeb();

    search("glasshall");
    expect(sigma.node("2")).toMatchObject({ zIndex: 2 });
    expect(sigma.node("0")).toMatchObject({ zIndex: 0 });
    expect(sigma.camera.animate).toHaveBeenCalledTimes(1);

    search("nothing by this name");
    expect(sigma.node("0")).toMatchObject({ zIndex: 1 });
    expect(sigma.camera.animate).toHaveBeenCalledTimes(1);
  });

  it("keeps its graph, and so its camera, across an equal drawing", () => {
    const { rerender } = renderWeb();
    const first = containerProps.at(-1)?.graph;

    rerender(
      <Constellation data={{ ...DATA, nodes: [...DATA.nodes] }} label="x" />
    );
    expect(containerProps.at(-1)?.graph).toBe(first);

    rerender(<Constellation data={{ ...DATA, key: "web-2" }} label="x" />);
    expect(containerProps.at(-1)?.graph).not.toBe(first);
  });

  it("says so in the web's place when the renderer loses its context", () => {
    const { getByText } = renderWeb();

    act(() => {
      sigma.canvas.dispatchEvent(new Event("webglcontextlost"));
    });
    expect(getByText("Your browser can't draw the web.")).toBeTruthy();
  });
});
