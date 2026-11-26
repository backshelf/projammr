"use client";

import { SigmaContainer } from "@react-sigma/core";
import { IconFocusCentered, IconMinus, IconPlus } from "@tabler/icons-react";
import { Anchor, type LinkComponent } from "@workspace/ui/components/anchor";
import { FloatingNote } from "@workspace/ui/components/floating-note";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Popover, PopoverContent } from "@workspace/ui/components/popover";
import { useCoarsePointer } from "@workspace/ui/hooks/use-coarse-pointer";
import {
  adjacencyOf,
  fitOf,
  litOf,
  matchesOf,
  type ConstellationData,
  type ConstellationNode,
  type Lit,
} from "@workspace/ui/lib/constellation";
import { isTypingTarget } from "@workspace/ui/lib/keymap";
import { AnimatePresence, useReducedMotion } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import { UndirectedGraph } from "graphology";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type Sigma from "sigma";
import {
  EdgeRectangleProgram,
  NodeCircleProgram,
  type NodeLabelDrawingFunction,
} from "sigma/rendering";
import type { Settings } from "sigma/settings";
import type { SigmaNodeEventPayload } from "sigma/types";
import { CONSTELLATION_FRAME } from "./constellation-frame";
import { NodeSquareProgram } from "./node-square-program";
import {
  css,
  gl,
  mix,
  readPalette,
  samePalette,
  type Palette,
} from "./palette";

type NodeAttributes = {
  x: number;
  y: number;
  size: number;
  label: string;
  type: ConstellationNode["shape"];
};
type EdgeAttributes = { size: number };
type Web = Sigma<NodeAttributes, EdgeAttributes>;

/** The closest the camera goes, and the furthest out past the fitted view. */
const MIN_RATIO = 0.05;
const MAX_RATIO = 1.25;
/** The closest a search's fit goes, so one match still shows its neighbours. */
const FIT_MIN_RATIO = 0.2;
const PAN_STEP = 0.1;
const MOVE_MS = 250;

/** Edge alpha at rest, from the commonest item's edge to the rarest's. */
const EDGE_ALPHA = { common: 0.1, rare: 0.55 } as const;
/** What a lit edge's alpha runs between, by the same rarity. */
const LIT_EDGE_ALPHA = { common: 0.45, rare: 0.95 } as const;
/** How far an unlit node or edge fades while something is lit. */
const DIM = 0.22;
/** A lit neighbourhood up to this many nodes names every one of them; in a
 *  larger one (a device in 190 sets) the label grid picks among them, since
 *  190 labels would be one grey smudge. The held node's own name is always in
 *  its note. */
const NAMED_NEIGHBOURHOOD = 40;

/**
 * Labels in the body mono face, soft ink at rest and ink when lit, with a
 * paper halo so a label reads over the hairlines beneath it. Also the hover
 * drawing, so a hovered node gets its label and nothing else: no box.
 */
const drawLabel: NodeLabelDrawingFunction<NodeAttributes, EdgeAttributes> = (
  context,
  data,
  settings
) => {
  if (!data.label) return;
  const { labelSize, labelFont, labelWeight } = settings;
  const attributes = data as typeof data & {
    labelColor?: string;
    halo?: string;
  };
  context.font = `${labelWeight} ${labelSize}px ${labelFont}`;
  const x = data.x + data.size + 4;
  const y = data.y + labelSize / 3;
  if (attributes.halo) {
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.strokeStyle = attributes.halo;
    context.strokeText(data.label, x, y);
  }
  context.fillStyle = attributes.labelColor ?? settings.labelColor.color ?? "";
  context.fillText(data.label, x, y);
};

/** Everything about the renderer that never changes. Passing the same object
 *  every render matters: a changed `settings` makes a new renderer. */
const SETTINGS: Partial<Settings<NodeAttributes, EdgeAttributes>> = {
  nodeProgramClasses: { circle: NodeCircleProgram, square: NodeSquareProgram },
  edgeProgramClasses: { rectangle: EdgeRectangleProgram },
  defaultNodeType: "circle",
  defaultEdgeType: "rectangle",
  hideEdgesOnMove: true,
  zIndex: true,
  minCameraRatio: MIN_RATIO,
  maxCameraRatio: MAX_RATIO,
  cameraPanBoundaries: true,
  minEdgeThickness: 1,
  stagePadding: 24,
  labelSize: 11,
  labelWeight: "400",
  labelDensity: 0.6,
  labelGridCellSize: 140,
  // The hubs name themselves at the fitted zoom; a set's dot grows past this
  // as the camera closes in, and the grid lets its name in where there is room.
  labelRenderedSizeThreshold: 4,
  defaultDrawNodeLabel: drawLabel,
  defaultDrawNodeHover: drawLabel,
};

/** Whether this browser can make a WebGL context at all, asked once. */
let webglSupport: boolean | undefined;
function hasWebGL(): boolean {
  if (webglSupport === undefined) {
    const canvas = document.createElement("canvas");
    webglSupport = Boolean(
      canvas.getContext("webgl2") ?? canvas.getContext("webgl")
    );
  }
  return webglSupport;
}
const noSubscription = () => () => {};

function graphOf({ nodes, edges }: ConstellationData) {
  // One edge per set and item: the server merged repeats before laying out.
  const graph = new UndirectedGraph<NodeAttributes, EdgeAttributes>();
  nodes.forEach((node, index) =>
    graph.addNode(String(index), {
      // The renderer's y axis points up; the layout's, like the page's, down.
      x: node.x,
      y: -node.y,
      size: node.size,
      label: node.label,
      type: node.shape,
    })
  );
  edges.forEach(([source, target, , thickness], index) =>
    graph.addEdgeWithKey(String(index), String(source), String(target), {
      size: thickness,
    })
  );
  return graph;
}

/** Every node's and edge's colour in each state, worked out once per palette
 *  rather than on every repaint. */
function coloursOf({ nodes, edges }: ConstellationData, palette: Palette) {
  const rest = (node: ConstellationNode) =>
    node.warn
      ? palette.warn
      : node.shape === "circle"
        ? palette.inkFaint
        : palette.inkSoft;
  const edgeRest = edges.map(([, , weight]) =>
    mix(palette.inkFaint, palette.inkSoft, weight)
  );
  const alpha = (range: { common: number; rare: number }, weight: number) =>
    range.common + (range.rare - range.common) * weight;
  return {
    node: nodes.map((node) => gl(rest(node))),
    nodeDim: nodes.map((node) => gl(rest(node), DIM)),
    nodeLit: nodes.map((node) => gl(node.warn ? palette.warn : palette.art)),
    edge: edges.map(([, , weight], index) =>
      gl(edgeRest[index]!, alpha(EDGE_ALPHA, weight))
    ),
    edgeDim: edges.map(([, , weight], index) =>
      gl(edgeRest[index]!, alpha(EDGE_ALPHA, weight) * DIM)
    ),
    edgeLit: edges.map(([, , weight]) =>
      gl(palette.art, alpha(LIT_EDGE_ALPHA, weight))
    ),
    label: css(palette.inkSoft),
    labelLit: css(palette.ink),
    halo: css(palette.paper, 0.85),
  };
}

export type ConstellationProps = {
  data: ConstellationData;
  /** What a screen reader hears in place of the drawing: the page's lede. */
  label: string;
  /** A search: the nodes whose label or meta holds it light, and the camera
   *  frames them. */
  highlight?: string;
  /** What the note's link out renders through: the app's router link. */
  link?: LinkComponent;
  className?: string;
};

/** What the note is about, and whether it is pinned (and so holds a link). */
type Note = { index: number; pinned: boolean };

/**
 * A pannable, zoomable node-link web in WebGL: sets as circles, the items
 * they use as squares, every position settled before it arrives. Hovering a
 * node (a fine pointer) lights it, its edges and its neighbours in `--art` and
 * dims the rest, and shows its note; a click or a tap pins it, and the pinned
 * note carries the node's link out, since the node itself never navigates. A
 * second click, Escape or a click on empty paper lets go. `highlight` lights
 * the matching nodes while nothing is held. Drag pans, the wheel and a pinch
 * zoom, and the canvas takes arrows, `+`, `-` and `0` once focused.
 *
 * Colours are the page's own tokens, read off the computed style and read
 * again when the theme changes; the lighting goes through the renderer's
 * reducers, so a hover never re-renders the drawing in React. Where WebGL
 * is missing or its context is lost, one line says so in the web's place.
 */
export function Constellation({
  data,
  label,
  highlight = "",
  link: Link = Anchor,
  className,
}: ConstellationProps) {
  const webgl = useSyncExternalStore(noSubscription, hasWebGL, () => null);
  const [lost, setLost] = useState(false);

  // An equal drawing (a re-render after opening a row) keeps its graph, and
  // the renderer keeps its camera.
  const [current, setCurrent] = useState(data);
  if (current.key !== data.key) setCurrent(data);
  const graph = useMemo(() => graphOf(current), [current]);

  if (webgl === false || lost) {
    return (
      <p className={cn("text-small text-ink-soft", className)}>
        Your browser can&apos;t draw the web.
      </p>
    );
  }

  return (
    <div className={cn(CONSTELLATION_FRAME, className)}>
      {webgl && (
        <Stage
          data={current}
          graph={graph}
          label={label}
          highlight={highlight}
          link={Link}
          onLost={() => setLost(true)}
        />
      )}
    </div>
  );
}

function Stage({
  data,
  graph,
  label,
  highlight,
  link: Link,
  onLost,
}: {
  data: ConstellationData;
  graph: UndirectedGraph<NodeAttributes, EdgeAttributes>;
  label: string;
  highlight: string;
  link: LinkComponent;
  onLost: () => void;
}) {
  const [sigma, setSigma] = useState<Web | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  /** What the note is placed against: a span kept over the noted node. The
   *  ref moves it; the state hands it to the note. */
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const mountAnchor = useCallback((element: HTMLSpanElement | null) => {
    anchorRef.current = element;
    setAnchor(element);
  }, []);
  const coarse = useCoarsePointer();
  const reducedMotion = useReducedMotion() ?? false;
  const [palette, setPalette] = useState<Palette | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  const adjacency = useMemo(() => adjacencyOf(data), [data]);
  const colours = useMemo(
    () => (palette ? coloursOf(data, palette) : null),
    [data, palette]
  );

  const pinnedRef = useRef<number | null>(null);
  const hoveredRef = useRef<number | null>(null);
  const matchesRef = useRef<number[]>([]);
  const litRef = useRef<Lit | null>(null);
  const noteRef = useRef<Note | null>(null);

  const duration = reducedMotion ? 0 : MOVE_MS;

  // The tokens resolve against the page, so they are read as the canvas
  // mounts and again whenever the theme flips; a page's artwork accent comes
  // along with `--art`. The theme is a class on the root that the app's
  // theme provider writes in an effect of its own, after `resolvedTheme` has
  // already changed, so the root is watched rather than the hook.
  const mountCanvas = useCallback((element: HTMLDivElement | null) => {
    canvasRef.current = element;
    if (!element) return;
    const read = () =>
      setPalette((prev) => {
        const next = readPalette(element);
        return prev && samePalette(prev, next) ? prev : next;
      });
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => {
      observer.disconnect();
      canvasRef.current = null;
    };
  }, []);

  /** Moves the note's anchor onto a node, in the canvas's own pixels. */
  const placeAnchor = useCallback(
    (index: number | null) => {
      const span = anchorRef.current;
      const display =
        index === null ? null : sigma?.getNodeDisplayData(String(index));
      if (!span || !sigma || !display) return;
      const { x, y } = sigma.framedGraphToViewport(display);
      const size = sigma.scaleSize(display.size);
      span.style.left = `${x - size}px`;
      span.style.top = `${y - size}px`;
      span.style.width = `${size * 2}px`;
      span.style.height = `${size * 2}px`;
    },
    [sigma]
  );

  /** Says what the note should show: the pin, else the hover, else nothing. */
  const syncNote = useCallback(() => {
    const pinned = pinnedRef.current;
    const hovered = hoveredRef.current;
    const next: Note | null =
      pinned !== null
        ? { index: pinned, pinned: true }
        : hovered !== null
          ? { index: hovered, pinned: false }
          : null;
    const prev = noteRef.current;
    if (prev?.index === next?.index && prev?.pinned === next?.pinned) return;
    noteRef.current = next;
    placeAnchor(next?.index ?? null);
    setNote(next);
  }, [placeAnchor]);

  /** Relights the drawing: only what changed, unless the whole room goes from
   *  lit to unlit or back. */
  const paint = useCallback(() => {
    if (!sigma) return;
    const held = pinnedRef.current ?? hoveredRef.current;
    const prev = litRef.current;
    const next = litOf(adjacency, held, matchesRef.current);
    litRef.current = next;
    if (!prev && !next) return;
    if (!prev || !next) {
      sigma.refresh();
      return;
    }
    sigma.refresh({
      partialGraph: {
        nodes: [...new Set([...prev.nodes, ...next.nodes])].map(String),
        edges: [...new Set([...prev.edges, ...next.edges])].map(String),
      },
    });
  }, [sigma, adjacency]);

  // Colours, fonts and motion reach the renderer as settings; the reducers
  // read what is lit from refs, so relighting is a refresh, not a render.
  useEffect(() => {
    const element = canvasRef.current;
    if (!sigma || !colours || !element) return;
    sigma.setSettings({
      labelFont: getComputedStyle(element).fontFamily,
      labelColor: { color: colours.label },
      zoomDuration: duration,
      inertiaDuration: duration,
      doubleClickZoomingDuration: duration,
      nodeReducer: (key, attributes) => {
        const index = Number(key);
        const lit = litRef.current;
        if (!lit) {
          return {
            ...attributes,
            color: colours.node[index],
            zIndex: 1,
            halo: colours.halo,
          };
        }
        // The held node's own name is in its note, beside it.
        if (index === lit.held) {
          return {
            ...attributes,
            color: colours.nodeLit[index],
            zIndex: 3,
            label: "",
          };
        }
        return lit.nodes.has(index)
          ? {
              ...attributes,
              color: colours.nodeLit[index],
              zIndex: 2,
              forceLabel: lit.nodes.size <= NAMED_NEIGHBOURHOOD,
              labelColor: colours.labelLit,
              halo: colours.halo,
            }
          : {
              ...attributes,
              color: colours.nodeDim[index],
              zIndex: 0,
              label: "",
            };
      },
      edgeReducer: (key, attributes) => {
        const index = Number(key);
        const lit = litRef.current;
        if (!lit)
          return { ...attributes, color: colours.edge[index], zIndex: 1 };
        return lit.edges.has(index)
          ? { ...attributes, color: colours.edgeLit[index], zIndex: 2 }
          : { ...attributes, color: colours.edgeDim[index], zIndex: 0 };
      },
    });
  }, [sigma, colours, duration]);

  // The pointer: hover lights (a fine pointer only), a click pins or lets
  // go, a click on empty paper lets go. A camera move drops the hover, since
  // the pointer is no longer over what it lit.
  useEffect(() => {
    if (!sigma) return;
    const element = canvasRef.current;
    const mouse = sigma.getMouseCaptor();
    const onEnter = ({ node, event }: SigmaNodeEventPayload) => {
      if (element) element.style.cursor = "pointer";
      // A node sliding under the pointer mid-drag is not a hover.
      if (coarse || mouse.isMouseDown) return;
      if (!(event.original instanceof MouseEvent)) return;
      hoveredRef.current = Number(node);
      paint();
      syncNote();
    };
    const onLeave = () => {
      if (element) element.style.cursor = "";
      if (hoveredRef.current === null) return;
      hoveredRef.current = null;
      paint();
      syncNote();
    };
    const onClickNode = ({ node }: SigmaNodeEventPayload) => {
      const index = Number(node);
      pinnedRef.current = pinnedRef.current === index ? null : index;
      paint();
      syncNote();
    };
    const onClickStage = () => {
      if (pinnedRef.current === null) return;
      pinnedRef.current = null;
      paint();
      syncNote();
    };
    const onAfterRender = () => placeAnchor(noteRef.current?.index ?? null);
    const camera = sigma.getCamera();
    const onCamera = () => {
      if (hoveredRef.current !== null) onLeave();
    };
    const onContextLost = () => onLost();

    sigma.on("enterNode", onEnter);
    sigma.on("leaveNode", onLeave);
    sigma.on("clickNode", onClickNode);
    sigma.on("clickStage", onClickStage);
    sigma.on("afterRender", onAfterRender);
    camera.on("updated", onCamera);
    const canvases = Object.values(sigma.getCanvases());
    for (const canvas of canvases) {
      canvas.addEventListener("webglcontextlost", onContextLost);
    }
    return () => {
      sigma.off("enterNode", onEnter);
      sigma.off("leaveNode", onLeave);
      sigma.off("clickNode", onClickNode);
      sigma.off("clickStage", onClickStage);
      sigma.off("afterRender", onAfterRender);
      camera.off("updated", onCamera);
      for (const canvas of canvases) {
        canvas.removeEventListener("webglcontextlost", onContextLost);
      }
    };
  }, [sigma, coarse, paint, syncNote, placeAnchor, onLost]);

  // The search lights its matches and brings them into frame.
  useEffect(() => {
    if (!sigma) return;
    const matches = matchesOf(data.nodes, highlight);
    matchesRef.current = matches;
    paint();
    if (matches.length === 0) return;
    const points = matches.flatMap(
      (index) => sigma.getNodeDisplayData(String(index)) ?? []
    );
    void sigma.getCamera().animate(fitOf(points, FIT_MIN_RATIO), { duration });
  }, [sigma, data, highlight, paint, duration]);

  const zoomIn = () => void sigma?.getCamera().animatedZoom({ duration });
  const zoomOut = () => void sigma?.getCamera().animatedUnzoom({ duration });
  const fit = () => void sigma?.getCamera().animatedReset({ duration });

  const unpin = () => {
    if (pinnedRef.current === null) return;
    pinnedRef.current = null;
    paint();
    syncNote();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!sigma || event.altKey || event.ctrlKey || event.metaKey) return;
    if (isTypingTarget(event.target)) return;
    const camera = sigma.getCamera();
    const { x, y, ratio } = camera.getState();
    const pan = (dx: number, dy: number) =>
      void camera.animate(
        { x: x + dx * PAN_STEP * ratio, y: y + dy * PAN_STEP * ratio },
        { duration: reducedMotion ? 0 : 120 }
      );
    const action: Record<string, () => void> = {
      ArrowLeft: () => pan(-1, 0),
      ArrowRight: () => pan(1, 0),
      ArrowUp: () => pan(0, 1),
      ArrowDown: () => pan(0, -1),
      "+": zoomIn,
      "=": zoomIn,
      "-": zoomOut,
      _: zoomOut,
      "0": fit,
      Escape: unpin,
    };
    const run = action[event.key];
    if (!run) return;
    event.preventDefault();
    run();
  };

  const noted = note ? data.nodes[note.index] : undefined;

  return (
    <>
      <div
        ref={mountCanvas}
        role="img"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="absolute inset-0 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <SigmaContainer<NodeAttributes, EdgeAttributes>
          ref={setSigma}
          graph={graph}
          settings={SETTINGS}
          // The library's stylesheet is not loaded: it paints the container
          // white. The paper and its grain show through instead.
          className="size-full [&>.sigma-container]:size-full"
          style={{ background: "transparent" }}
        />
      </div>
      <span
        ref={mountAnchor}
        aria-hidden
        className="pointer-events-none absolute"
      />
      <div className="absolute top-2 right-2 flex gap-1">
        <IconButton size="touch" aria-label="Zoom in" onClick={zoomIn}>
          <IconPlus />
        </IconButton>
        <IconButton size="touch" aria-label="Zoom out" onClick={zoomOut}>
          <IconMinus />
        </IconButton>
        <IconButton size="touch" aria-label="Fit the web" onClick={fit}>
          <IconFocusCentered />
        </IconButton>
      </div>
      <Popover
        open={note?.pinned === true}
        onOpenChange={(open, details) => {
          if (open) return;
          // A press on the canvas is the renderer's to read: it pins another
          // node, lets go, or pans.
          if (
            details.reason === "outside-press" &&
            details.event.target instanceof Node &&
            canvasRef.current?.contains(details.event.target)
          ) {
            return;
          }
          unpin();
        }}
      >
        {note?.pinned && noted && (
          <PopoverContent
            anchor={anchor}
            aria-label={noted.label}
            initialFocus={false}
            finalFocus={false}
            side="right"
            align="start"
            className="w-auto max-w-72 gap-0 p-0"
          >
            <NoteBody node={noted}>
              {noted.link && (
                <Link
                  href={noted.link.href}
                  className="mt-1 self-start text-micro text-ink underline-offset-2 hover:text-art hover:underline focus-visible:underline"
                >
                  {noted.link.label}
                </Link>
              )}
            </NoteBody>
          </PopoverContent>
        )}
      </Popover>
      <AnimatePresence>
        {note && !note.pinned && noted && (
          <FloatingNote
            key="constellation-note"
            anchor={anchor}
            placement="beside"
          >
            <NoteBody node={noted} />
          </FloatingNote>
        )}
      </AnimatePresence>
    </>
  );
}

function NoteBody({
  node,
  children,
}: {
  node: ConstellationNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex max-w-72 flex-col gap-0.5 px-3 py-2 text-small break-words">
      <span className="text-ink">{node.label}</span>
      {node.meta && (
        <span className="text-micro text-ink-soft">{node.meta}</span>
      )}
      <span className="text-micro text-ink-soft tabular-nums">
        {node.count}
      </span>
      {children}
    </div>
  );
}
