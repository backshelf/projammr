import { AppLink } from "@/components/navigation/AppLink";
import { samplesPageHref, type SamplesDefaults } from "@/lib/samples-graph";
import { sampleDownloadHref, sampleState } from "@/lib/sample-state";
import type { SampleUsage, Session } from "@workspace/api/api";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { keyedByContent } from "@workspace/ui/lib/keyed";
import { sampleFileName, sampleFolder } from "@workspace/ui/lib/sample-path";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The samples a session's file references: the filename over its folder, what
 * Live cannot find called out above the rows, and, per sample, how many other
 * sets in the project use it. `usage` is the project's samples list; without it
 * (it failed to load) the rows simply carry no reach. A reach links to the
 * sample's row on the samples page, written against the viewer's `defaults`
 * for that page.
 */
export function SessionSamples({
  session,
  usage,
  defaults,
}: {
  session: Pick<Session, "id" | "projectId" | "samples" | "repoId">;
  usage: SampleUsage[] | undefined;
  defaults: SamplesDefaults;
}) {
  const samples = session.samples ?? [];
  const usageByPath = new Map(usage?.map((u) => [u.path, u]));
  const missing = samples.filter((s) => s.status === "missing").length;
  const hasOutside = samples.some((s) => s.kind === "outside");

  return (
    <section>
      <SectionHead count={samples.length}>SAMPLES</SectionHead>
      {(missing > 0 || hasOutside) && (
        <div className="mb-2 space-y-1 text-small text-pretty">
          {missing > 0 && (
            <p className="text-ink">
              Live can&apos;t find {missing}{" "}
              {missing === 1 ? "sample" : "samples"}
            </p>
          )}
          {hasOutside && (
            <p className="text-ink-soft">
              Collect All and Save in Live brings these into the project.
            </p>
          )}
        </div>
      )}
      <Rows as="ul">
        {keyedByContent(samples, (s) => s.path).map(({ key, item: sample }) => {
          const name = sampleFileName(sample.path);
          const folder = sampleFolder(sample.path);
          const state = sampleState(sample, session.repoId != null);
          const isMissing = state === "missing";
          const download = sampleDownloadHref(session.repoId, sample.object);
          const others = Math.max(
            (usageByPath.get(sample.path)?.sessions ?? 0) - 1,
            0
          );

          return (
            <Row as="li" key={key}>
              <RowMain>
                <RowTitle
                  title={sample.path}
                  className={cn(isMissing && "text-ink-faint line-through")}
                >
                  {isMissing && <span aria-hidden>− </span>}
                  {name}
                </RowTitle>
                {folder && <RowMeta>{folder}</RowMeta>}
              </RowMain>
              {state != null && (
                <span className="shrink-0 text-micro text-ink-soft">
                  {state}
                </span>
              )}
              {state === "on the hub" && download && (
                <a
                  href={download}
                  download
                  aria-label={`Download ${name}`}
                  className="shrink-0 rounded-sm text-micro text-ink-soft outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  Download
                </a>
              )}
              {others > 0 && (
                <AppLink
                  href={samplesPageHref(
                    session.projectId,
                    {
                      sample: sample.path,
                      library: sample.kind === "library",
                    },
                    defaults
                  )}
                  className="shrink-0 rounded-sm text-micro text-ink-soft outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ring/30"
                >
                  in {others} other {others === 1 ? "set" : "sets"}
                  <span className="sr-only"> using {name}</span>
                </AppLink>
              )}
            </Row>
          );
        })}
      </Rows>
    </section>
  );
}
