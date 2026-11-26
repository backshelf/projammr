import { PAGE } from "@workspace/ui/lib/shell";
import { cachedCustomFields, cachedProject } from "@/lib/server-data";
import { getStatuses } from "@/actions/statuses";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { CollectionForm } from "@/components/forms/CollectionForm";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { createBreadcrumbs, hrefFromParsedRoute } from "@/lib/utils";
import { loaded } from "@/lib/loaded";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";

export default async function NewCollection({
  projectId,
}: {
  projectId: number;
}) {
  const statuses = getStatuses(projectId);
  const [projectResult, customFields] = await Promise.all([
    cachedProject(projectId),
    cachedCustomFields(projectId, "collection"),
  ]);

  const project = loaded(projectResult);

  return (
    <ScrollRoot className={PAGE}>
      <PageHead
        crumbs={
          <Breadcrumbs
            crumbs={[
              ...createBreadcrumbs(project),
              {
                label: "New collection",
                href: hrefFromParsedRoute(
                  { kind: "collection-new" },
                  projectId
                ),
              },
            ]}
          />
        }
        title={"New collection"}
        lede={"An album, an EP, a single — anything a set of tracks ships as."}
      />
      <CollectionForm
        projectId={projectId}
        statusesProm={statuses}
        customFields={customFields}
      />
    </ScrollRoot>
  );
}
