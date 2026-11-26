import { RulerScale } from "@workspace/ui/components/loudness/ruler-scale";
import {
  defaultFormatters,
  type Formatters,
} from "@workspace/ui/lib/formatters";
import type { Readout } from "@workspace/session-diff";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

type ReadoutOf<G extends Readout["gauge"]> = Extract<Readout, { gauge: G }>;

/** A value that moved, as `from → to`: what it was in soft ink, what it is in ink. */
function Transition({
  from,
  to,
  unit,
}: {
  from: string | null;
  to: string;
  unit?: string;
}) {
  return (
    <p className="text-body tabular-nums">
      <span className="text-ink-soft">{from ?? "—"}</span>
      <span className="text-ink-faint"> → </span>
      <span className="text-ink">{to}</span>
      {unit && <span className="ml-1 text-micro text-ink-soft">{unit}</span>}
    </p>
  );
}

/** A figure on its ruler: a faint tick where it was, the art tick where it is,
 *  the span between them lit, and the caret travelling across it. */
function RulerGauge({ readout }: { readout: ReadoutOf<"ruler"> }) {
  const { ruler, from, to, label } = readout;
  return (
    <>
      <Transition
        from={from == null ? null : String(from)}
        to={String(to)}
        unit={ruler.unit}
      />
      <RulerScale
        config={ruler}
        marks={[{ value: to, label: "Now" }]}
        band={
          from == null ? undefined : [Math.min(from, to), Math.max(from, to)]
        }
        pointer={to}
        was={from ?? undefined}
        label={
          from == null
            ? `${label}: ${to} ${ruler.unit ?? ""}`.trim()
            : `${label} moved from ${from} to ${to} ${ruler.unit ?? ""}`.trim()
        }
        className="mt-2"
      />
    </>
  );
}

/** A count's change, signed: `+16` in art, `−12` in faint ink, nothing when it held. */
function Delta({ by, format }: { by: number; format: Formatters }) {
  if (by === 0) return null;
  return (
    <span className={cn("ml-2", by > 0 ? "text-art" : "text-ink-faint")}>
      {by > 0 ? "+" : "−"}
      {format.number(Math.abs(by))}
    </span>
  );
}

/** One count as a meter: what it kept in soft ink, what the save added in
 *  art, what it took away dotted. All of a readout's meters share one scale,
 *  and a change never draws narrower than 2px, so a small one on a large
 *  set still shows; the kept part yields that width back, never the change.
 *  The rest of the track is the meter's own ground. */
function DeltaMeter({
  label,
  from,
  to,
  scale,
  format,
}: {
  label: string;
  from: number;
  to: number;
  scale: number;
  format: Formatters;
}) {
  const share = (n: number) => `max(2px, ${(n / scale) * 100}%)`;
  const grown = Math.max(0, to - from);
  const lost = Math.max(0, from - to);

  return (
    <div>
      <p className="flex items-baseline justify-between gap-3 text-small tabular-nums">
        <span className="text-ink-soft">{label}</span>
        <span>
          <span className="text-ink-soft">{format.number(from)}</span>
          <span className="text-ink-faint"> → </span>
          <span className="text-ink">{format.number(to)}</span>
          <Delta by={to - from} format={format} />
        </span>
      </p>
      <div
        role="img"
        aria-label={`${label} ${from} to ${to}`}
        className="mt-1.5 flex h-0.5 bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]"
      >
        <i
          className="block h-full min-w-0 bg-[color-mix(in_oklab,var(--ink)_32%,transparent)]"
          style={{ flex: `0 1 ${(Math.min(from, to) / scale) * 100}%` }}
        />
        {grown > 0 && (
          <i
            className="block h-full shrink-0 bg-art"
            style={{ width: share(grown) }}
          />
        )}
        {lost > 0 && (
          <i
            className="block h-full shrink-0 bg-[repeating-linear-gradient(90deg,var(--ink-faint)_0_2px,transparent_2px_4px)]"
            style={{ width: share(lost) }}
          />
        )}
      </div>
    </div>
  );
}

function MetersGauge({
  readout,
  format,
}: {
  readout: ReadoutOf<"meters">;
  format: Formatters;
}) {
  const scale = Math.max(
    1,
    ...readout.meters.flatMap((meter) => [meter.from, meter.to])
  );
  return (
    <div className="flex flex-col gap-2.5">
      {readout.meters.map((meter) => (
        <DeltaMeter
          key={meter.label}
          {...meter}
          scale={scale}
          format={format}
        />
      ))}
    </div>
  );
}

function TransitionGauge({ readout }: { readout: ReadoutOf<"transition"> }) {
  return <Transition from={readout.from} to={readout.to} />;
}

/** The drawing each gauge kind is: the card's vocabulary of readouts, which
 *  any facet's change is set on. */
function Gauge({ readout, format }: { readout: Readout; format: Formatters }) {
  switch (readout.gauge) {
    case "ruler":
      return <RulerGauge readout={readout} />;
    case "meters":
      return <MetersGauge readout={readout} format={format} />;
    case "transition":
      return <TransitionGauge readout={readout} />;
  }
}

/**
 * The values a save moved, each on its gauge under its label, in two columns
 * where the card has the room, counts written in the viewer's `format` (the
 * defaults for a page with no viewer). Renders nothing when nothing moved.
 */
export function DiffReadouts({
  readouts,
  format = defaultFormatters(),
  className,
}: {
  readouts: Readout[];
  format?: Formatters;
  className?: string;
}) {
  if (readouts.length === 0) return null;

  return (
    <dl
      className={cn(
        "grid gap-x-10 gap-y-5 @lg/save-diff:grid-cols-2",
        className
      )}
    >
      {readouts.map((readout) => (
        <div key={readout.label} className="min-w-0">
          <dt className={cn(LABEL, "mb-1.5 text-ink-soft")}>{readout.label}</dt>
          <dd>
            <Gauge readout={readout} format={format} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
