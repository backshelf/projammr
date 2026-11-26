import { RailLabel } from "@workspace/ui/components/layout/rail";
import { pluralizeCount } from "@workspace/session-diff/format";
import { Meter } from "@workspace/ui/components/table";

/**
 * How far the collection has got: the share of its tracks that have reached
 * the end of the status pipeline, over a meter of the average completion
 * across every track.
 */
export function CollectionProgress({
  value,
  trackCount,
  completeCount,
}: {
  value: number;
  trackCount?: number;
  completeCount?: number;
}) {
  const showsCount = completeCount !== undefined && trackCount !== undefined;

  return (
    <div>
      <RailLabel
        action={
          showsCount ? (
            <span>
              {completeCount} of {trackCount}
            </span>
          ) : undefined
        }
      >
        COMPLETE
      </RailLabel>
      <Meter
        value={Math.round(value)}
        className={"mt-2"}
        barClassName={"motion-settle"}
        title={
          trackCount === undefined
            ? undefined
            : `Average completion across ${pluralizeCount(trackCount, "track")}`
        }
      />
    </div>
  );
}
