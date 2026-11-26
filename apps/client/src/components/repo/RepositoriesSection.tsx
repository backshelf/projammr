import type { getTrackRepos } from "@/actions/repos";
import { ReposTable } from "@/components/tables/ReposTable";
import { getCachedSession, sessionUser } from "@/lib/session";
import { isActionError } from "@workspace/api/lib/action-result";
import { Arrive } from "@workspace/ui/components/layout/arrive";
import { SectionHead } from "@workspace/ui/components/layout/section-head";

/**
 * A track's or a collection's repositories table: the dit repos holding a set
 * of the page's sessions. It renders nothing until one does (and when the read
 * fails), not an `EmptySection`, so a page with no repo gains no add-line entry
 * and no heading.
 */
export async function RepositoriesSection({
  reposPromise,
  projectId,
}: {
  reposPromise: ReturnType<typeof getTrackRepos>;
  projectId: number;
}) {
  const [repos, session] = await Promise.all([
    reposPromise,
    getCachedSession(),
  ]);
  if (isActionError(repos) || repos.length === 0) return null;

  return (
    <Arrive>
      <section>
        <SectionHead count={repos.length}>REPOSITORIES</SectionHead>
        <ReposTable
          repos={repos}
          projectId={projectId}
          viewerId={sessionUser(session)?.id ?? null}
        />
      </section>
    </Arrive>
  );
}
