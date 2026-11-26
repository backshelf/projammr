import { Anchor, type LinkComponent } from "@workspace/ui/components/anchor";
import {
  PATCHBAY_ROW_PX,
  type PatchNode,
  type PatchbayLayout,
} from "@workspace/ui/lib/patchbay";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { CSSProperties, ReactNode } from "react";

/** The cable drawing's own width; `preserveAspectRatio="none"` stretches it
 *  across whatever the middle column is. */
const BAY_WIDTH = 100;

type Side = "left" | "right";

function Head({ side, children }: { side: Side; children?: ReactNode }) {
  return (
    <div
      className={cn(
        LABEL,
        "sticky top-0 z-1 flex h-8 items-center bg-paper/95 text-ink-soft",
        side === "left" && "justify-end"
      )}
    >
      {children}
    </div>
  );
}

function Node({
  node,
  side,
  own,
  link: Link,
}: {
  node: PatchNode;
  side: Side;
  own: number | undefined;
  link: LinkComponent;
}) {
  return (
    <li
      data-pb-node={node.id}
      data-pb-side={side}
      data-missing={node.missing || undefined}
      tabIndex={node.href ? undefined : 0}
      className={cn(
        "group/pb-node flex h-(--pb-row) min-w-0 items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
        "group-data-dim/patchbay:opacity-35 data-hot:opacity-100! motion-safe:motion-reveal",
        side === "left" && "flex-row-reverse"
      )}
    >
      <i
        aria-hidden
        className={cn(
          "block size-1.5 shrink-0 rounded-full",
          node.missing
            ? "border border-ink-soft group-data-hot/pb-node:border-art"
            : "bg-ink-soft group-data-hot/pb-node:bg-art"
        )}
      />
      <span
        className={cn(
          "flex min-w-0 flex-1 items-baseline gap-2",
          side === "left" && "justify-end"
        )}
      >
        {node.href ? (
          <Link
            href={node.href}
            className="min-w-0 truncate text-ink underline-offset-2 hover:underline focus-visible:underline"
          >
            <span data-pb-label="">{node.label}</span>
          </Link>
        ) : (
          <span data-pb-label="" className="min-w-0 truncate text-ink">
            {node.label}
          </span>
        )}
        {node.missing && <span className="sr-only">, missing</span>}
        {node.meta && (
          <span
            data-pb-meta=""
            className="min-w-0 shrink-[2] truncate text-micro text-ink-soft"
          >
            {node.meta}
          </span>
        )}
        {own ? (
          <span className="shrink-0 text-micro text-ink-faint tabular-nums">
            +{own} own
          </span>
        ) : null}
      </span>
    </li>
  );
}

function Rail({
  side,
  nodes,
  own,
  more,
  head,
  link,
}: {
  side: Side;
  nodes: PatchNode[];
  own: Map<string, number>;
  more: number;
  head: ReactNode;
  link: LinkComponent;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <Head side={side}>{head}</Head>
      <ol data-pb-rail={side}>
        {nodes.map((node) => (
          <Node
            key={node.id}
            node={node}
            side={side}
            own={side === "left" ? own.get(node.id) : undefined}
            link={link}
          />
        ))}
      </ol>
      {more > 0 && (
        <p
          className={cn(
            LABEL,
            "flex h-(--pb-row) items-center text-ink-faint tabular-nums",
            side === "left" && "justify-end"
          )}
        >
          +{more} more
        </p>
      )}
    </div>
  );
}

/**
 * Two rails of nodes with a hairline cable per use between them: the left
 * rail's nodes down one column, the right rail's down the other, laid out by
 * `layoutPatchbay`. Every row is `PATCHBAY_ROW_PX` tall, so a cable runs from
 * its left row's centre to its right row's centre with no measuring. A
 * section shows the top rows of each rail (the caps). A missing node draws
 * hollow and its cables dashed; a left node's single-use right nodes read as
 * "+{n} own"; a capped rail ends in "+{n} more". Pure markup that renders on
 * the server: each node carries `data-pb-node` and `data-pb-side`, each cable
 * `data-pb-cable="{leftId}|{rightId}"`, and a node's row is its place in its
 * rail's `ol`, which is all a client leaf needs to light the drawing. A node
 * with an `href` links out through `link`, a plain anchor unless the caller
 * hands over its router link.
 */
export function Patchbay({
  layout,
  leftHead,
  rightHead,
  summary,
  link = Anchor,
}: {
  layout: PatchbayLayout;
  leftHead: ReactNode;
  rightHead: ReactNode;
  /** What a screen reader hears in place of the cables. */
  summary: string;
  link?: LinkComponent;
}) {
  const row = PATCHBAY_ROW_PX;
  const height = Math.max(layout.left.length, layout.right.length) * row;
  const centre = (index: number) => (index + 0.5) * row;
  const middle = BAY_WIDTH / 2;

  return (
    <div
      data-pb-root=""
      className="group/patchbay grid grid-cols-[minmax(0,1fr)_minmax(2.5rem,6rem)_minmax(0,1fr)] text-small"
      style={{ "--pb-row": `${row}px` } as CSSProperties}
    >
      <Rail
        side="left"
        nodes={layout.left}
        own={layout.own}
        more={layout.moreLeft}
        head={leftHead}
        link={link}
      />
      <div className="flex flex-col">
        <Head side="right" />
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${BAY_WIDTH} ${Math.max(height, 1)}`}
          preserveAspectRatio="none"
          className="block w-full fill-none stroke-ink-faint"
          style={{ height: `${height}px` }}
        >
          {layout.cables.map((cable) => {
            const left = layout.left[cable.left];
            const right = layout.right[cable.right];
            if (!left || !right) return null;
            const from = centre(cable.left);
            const to = centre(cable.right);
            return (
              <path
                key={`${cable.left}:${cable.right}`}
                data-pb-cable={`${left.id}|${right.id}`}
                data-missing={cable.missing || undefined}
                d={`M0 ${from} C${middle} ${from} ${middle} ${to} ${BAY_WIDTH} ${to}`}
                className="group-data-dim/patchbay:opacity-35 data-hot:stroke-art data-hot:opacity-100! motion-safe:transition-[stroke,opacity] motion-safe:duration-(--dur-quick) motion-safe:ease-(--ease-arrive)"
                strokeWidth={1}
                strokeDasharray={cable.missing ? "3 3" : undefined}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
      </div>
      <Rail
        side="right"
        nodes={layout.right}
        own={layout.own}
        more={layout.moreRight}
        head={rightHead}
        link={link}
      />
    </div>
  );
}
