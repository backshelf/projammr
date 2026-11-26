import { AppLink } from "@/components/navigation/AppLink";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { LastPushLine } from "@/components/repo/LastPush";
import { RepoPushSamples } from "@/components/repo/RepoPushSamples";
import { cachedFormatters } from "@/lib/formatters";
import { loaded } from "@/lib/loaded";
import { storageLine } from "@/lib/repo-copy";
import { roleSatisfies } from "@/lib/roles";
import { cachedProject, cachedRepo } from "@/lib/server-data";
import { getCachedSession, sessionUser } from "@/lib/session";
import { createBreadcrumbs, hrefFromParsedRoute } from "@/lib/utils";
import { Button } from "@workspace/ui/components/button";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { PAGE } from "@workspace/ui/lib/shell";
import { notFound } from "next/navigation";

export default async function RepoPage({
  projectId,
  repoId,
}: {
  projectId: number;
  repoId: number;
}) {
  const [projectResult, repoResult, format, session] = await Promise.all([
    cachedProject(projectId),
    cachedRepo(repoId),
    cachedFormatters(projectId),
    getCachedSession(),
  ]);

  const project = loaded(projectResult);
  const repo = loaded(repoResult);
  // The API gates a repo on membership of its own project, not on the URL's.
  if (repo.projectId !== projectId) notFound();

  const href = hrefFromParsedRoute({ kind: "repo", repoId }, projectId);

  return (
    <ScrollRoot className={PAGE}>
      <PageHead
        crumbs={
          <Breadcrumbs
            crumbs={[...createBreadcrumbs(project), { label: repo.name, href }]}
          />
        }
        title={repo.name}
        lede={
          <>
            <LastPushLine
              repo={repo}
              format={format}
              viewerId={sessionUser(session)?.id ?? null}
            />{" "}
            ·{" "}
            <AppLink
              href={`${hrefFromParsedRoute({ kind: "session-all" }, projectId)}?inDit=false`}
              className="text-ink underline-offset-4 hover:underline focus-visible:underline"
            >
              Sessions not in dit
            </AppLink>
          </>
        }
        action={
          <RepoPushSamples
            repoId={repo.id}
            pushSamples={repo.pushSamples}
            forced={repo.pushSamplesForced}
            canEdit={roleSatisfies(project.role, "editor")}
          />
        }
      />
      {repo.sets.length > 0 && (
        <section>
          <SectionHead
            action={
              <span className="text-small text-ink-soft tabular-nums">
                {storageLine(repo.storage, format)}
              </span>
            }
          >
            STORAGE
          </SectionHead>
        </section>
      )}
      {repo.sets.length > 0 && (
        <section>
          <SectionHead
            count={repo.sets.length}
            action={
              repo.sets.some((set) =>
                set.branches.some(
                  (branch) => branch.name === "main" && branch.tip
                )
              ) ? (
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={`/api/repos/${repo.id}/archive`}
                    download
                    aria-label={`Download repository ${repo.name}`}
                  >
                    Download repository
                  </a>
                </Button>
              ) : undefined
            }
          >
            SETS
          </SectionHead>
          <Rows as="ul">
            {repo.sets.map((set) => (
              <Row
                as="li"
                key={set.sessionId}
                className="flex-col items-stretch gap-1.5"
              >
                <AppLink
                  href={hrefFromParsedRoute(
                    { kind: "session", sessionId: set.sessionId },
                    projectId
                  )}
                  className="block min-w-0 truncate text-body text-ink motion-ink hover:text-ink-soft"
                >
                  {set.sessionName}
                </AppLink>
                {set.branches.length === 0 ? (
                  <RowMeta>No commits yet</RowMeta>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {set.branches.map((branch) => (
                      <li
                        key={branch.name}
                        className="flex items-center gap-3.5"
                      >
                        <RowMain>
                          <RowTitle className="text-small">
                            {branch.name}
                          </RowTitle>
                          <RowMeta>
                            {branch.tip
                              ? `${branch.tip.message} · ${format.relative(branch.tip.committedAt)}`
                              : "No commits yet"}
                          </RowMeta>
                        </RowMain>
                        {branch.tip && (
                          <Button variant="ghost" size="sm" asChild>
                            <a
                              href={`/api/commits/${branch.tip.commitId}/set`}
                              download
                              aria-label={`Download set, ${branch.name} of ${set.sessionName}`}
                            >
                              Download set
                            </a>
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
            ))}
          </Rows>
        </section>
      )}
    </ScrollRoot>
  );
}
