import { AppLink } from "@/components/navigation/AppLink";
import { TABLE_THUMB_WIDTH } from "@/components/tables/columns";
import { hrefFromParsedRoute, imageUrl } from "@/lib/utils";
import { TABLE_PARAM } from "@/lib/table-params";
import type { ProjectToday } from "@workspace/api/api";
import {
  type ActionError,
  isActionError,
} from "@workspace/api/lib/action-result";
import { Arrive } from "@workspace/ui/components/layout/arrive";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { TrackCell } from "@workspace/ui/components/table";
import { cachedEffectiveSettings } from "@/lib/settings/server";
import { quietDaysLabel, quietMoreLabel, quietSinceLabel } from "./quiet-copy";

/**
 * The live tracks going stale: a hairline row per track, oldest first, and a
 * trailing link to the whole list when more are quiet than the rows show.
 * Renders nothing when there are none or the read failed.
 */
export async function QuietSection({
  projectId,
  today,
}: {
  projectId: number;
  today: Promise<ProjectToday | ActionError>;
}) {
  const [result, settings] = await Promise.all([
    today,
    cachedEffectiveSettings(projectId),
  ]);
  if (isActionError(result) || result.quiet.tracks.length === 0) return null;

  const quietAfterDays = settings.values["project-conventions.quietAfterDays"];
  const { tracks, total } = result.quiet;
  const moreLabel = quietMoreLabel(tracks.length, total);
  const now = new Date();

  return (
    <Arrive>
      <section>
        <SectionHead count={quietDaysLabel(quietAfterDays)}>
          GONE QUIET
        </SectionHead>
        <Rows className="border-b border-rule">
          {tracks.map((track) => (
            <Row
              key={track.id}
              as={AppLink}
              href={hrefFromParsedRoute(
                { kind: "track", trackId: track.id },
                projectId
              )}
            >
              <TrackCell
                size="lg"
                image={imageUrl(track.artwork?.assetPath, TABLE_THUMB_WIDTH)}
              >
                <RowMain>
                  <RowTitle>{track.title}</RowTitle>
                  <RowMeta>{track.artists.join(", ")}</RowMeta>
                </RowMain>
              </TrackCell>
              {track.status && (
                <StatusChip
                  colour={track.status.colourHex}
                  percentage={track.status.percentage}
                >
                  {track.status.name}
                </StatusChip>
              )}
              <span className="ml-auto text-micro text-ink-soft tabular-nums">
                {quietSinceLabel(track.lastTouchedAt, now, quietAfterDays)}
              </span>
            </Row>
          ))}
          {moreLabel && (
            <Row
              as={AppLink}
              href={`${hrefFromParsedRoute({ kind: "track-all" }, projectId)}?${TABLE_PARAM.sort}=lastSaveAt.asc`}
            >
              <RowMain>
                <RowMeta>{moreLabel} →</RowMeta>
              </RowMain>
            </Row>
          )}
        </Rows>
      </section>
    </Arrive>
  );
}
