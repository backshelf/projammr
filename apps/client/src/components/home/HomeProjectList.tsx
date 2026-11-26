import { AppLink } from "@/components/navigation/AppLink";
import { cachedFormatters } from "@/lib/formatters";
import { hrefFromParsedRoute, mediaProxyUrl } from "@/lib/utils";
import { ArchivedCountNote } from "@/components/project/ProjectStats";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { MyProject } from "@workspace/api/api";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { TrackCell } from "@workspace/ui/components/table";

/**
 * The signed-in user's own projects: a hairline row per project linking
 * straight into it, with enough at a glance — cover, track count, how
 * recently anything happened — to tell them apart without opening one.
 */
export async function HomeProjectList({ projects }: { projects: MyProject[] }) {
  const format = await cachedFormatters();

  return (
    <Rows className="border-b border-rule">
      {projects.map((project) => (
        <Row
          key={project.id}
          as={AppLink}
          href={hrefFromParsedRoute({ kind: "project" }, project.id)}
        >
          <TrackCell size="lg" image={mediaProxyUrl(project.image) || null}>
            <RowMain>
              <RowTitle>{project.name}</RowTitle>
              <RowMeta>
                {pluralizeCount(project.trackCount, "track")} ·{" "}
                {format.relative(project.lastActivityAt ?? project.updatedAt)}
              </RowMeta>
              <ArchivedCountNote
                live={project.trackCount}
                archived={project.archivedTrackCount}
              />
            </RowMain>
          </TrackCell>
        </Row>
      ))}
    </Rows>
  );
}
