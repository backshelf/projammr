import { getProjectRepos } from "@/actions/repos";
import { AppLink } from "@/components/navigation/AppLink";
import { hrefFromParsedRoute } from "@/lib/utils";
import { lastPushLine, storageLine } from "@/lib/repo-copy";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import type { Formatters } from "@workspace/ui/lib/formatters";

/**
 * The project's dit repositories, each opening its repo page. Renders nothing
 * while the project has none, so Assets keeps its shape for a project that has
 * never been pushed to.
 */
export async function ProjectRepos({
  projectId,
  format,
}: {
  projectId: number;
  format: Pick<Formatters, "relative" | "bytes">;
}) {
  const repos = await getProjectRepos(projectId);
  if (isActionError(repos) || repos.length === 0) return null;

  return (
    <section>
      <SectionHead count={repos.length}>REPOSITORIES</SectionHead>
      <Rows className="border-b border-rule">
        {repos.map((repo) => (
          <Row
            key={repo.id}
            as={AppLink}
            href={hrefFromParsedRoute(
              { kind: "repo", repoId: repo.id },
              projectId
            )}
          >
            <RowMain>
              <RowTitle>{repo.name}</RowTitle>
              <RowMeta>
                {lastPushLine(repo, format)} ·{" "}
                {storageLine(repo.storage, format)}
              </RowMeta>
            </RowMain>
          </Row>
        ))}
      </Rows>
    </section>
  );
}
