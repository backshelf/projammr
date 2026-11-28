"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { PlayAffordance } from "@/components/music-player/PlayAffordance";
import { TABLE_THUMB_WIDTH } from "@/components/tables/columns";
import { hrefFromParsedRoute, imageUrl } from "@/lib/utils";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
} from "@workspace/ui/components/layout/rows";
import { rowPlay, TrackCell } from "@workspace/ui/components/table";
import { renderToPlayable, type TodayRender } from "./playable";

/**
 * One track-audio version that landed today. Its play control plays that
 * version, not the track's primary, and the row reads the same for a viewer
 * as for a member: it has no edit or delete.
 */
export function RenderRow({
  row,
  projectId,
  versionLabel,
}: {
  row: TodayRender;
  projectId: number;
  versionLabel?: string;
}) {
  const format = useFormat();
  const title = row.owner?.title ?? row.asset.name;
  const versionText = versionLabel || `v${row.version}`;

  return (
    <Row>
      <TrackCell
        size="lg"
        className="flex-1"
        image={imageUrl(row.owner?.artwork?.assetPath, TABLE_THUMB_WIDTH)}
      >
        <RowMain>
          <AppLink
            href={hrefFromParsedRoute(
              { kind: "track", trackId: row.trackId },
              projectId
            )}
            className="block min-w-0"
          >
            <RowTitle>{title}</RowTitle>
          </AppLink>
          <RowMeta>
            {versionText} · {format.relative(row.createdAt)}
          </RowMeta>
        </RowMain>
      </TrackCell>
      <PlayAffordance
        kind="track"
        id={row.trackId}
        title={title}
        playable={renderToPlayable(row)}
        className={rowPlay}
      />
    </Row>
  );
}
