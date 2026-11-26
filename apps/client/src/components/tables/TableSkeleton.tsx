/**
 * Holds a table's space while its rows are still in flight, so the page around
 * it settles at its final height instead of jumping when the data lands.
 */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className={"w-full"} aria-hidden>
      <div className={"mb-3 h-9 w-64 shimmer-surface rounded bg-ink/8"} />
      <div className={"flex flex-col gap-px"}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={"h-10 shimmer-surface rounded bg-ink/5"} />
        ))}
      </div>
    </div>
  );
}
