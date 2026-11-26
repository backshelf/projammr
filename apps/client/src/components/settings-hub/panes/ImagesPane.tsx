import { getImagesForProject } from "@/actions/images";
import SettingsImageGrid from "@/components/settings/SettingsImageGrid";
import { PageLinks } from "@/components/tables/PageLinks";
import { parsePageParam } from "@/lib/table-params";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane, HubPaneProps } from "./types";

async function Images({ project, searchParams }: HubPaneProps) {
  if (!project) return null;
  const result = await getImagesForProject(
    project.id,
    parsePageParam(searchParams)
  );

  if (isActionError(result)) {
    return <SettingsImageGrid images={[]} />;
  }

  return (
    <>
      <SettingsImageGrid images={result.rows} />
      <PageLinks
        page={result.page}
        pageSize={result.pageSize}
        rowCount={result.rowCount}
      />
    </>
  );
}

/** Every image uploaded to the project, a page at a time. */
export const ImagesPane: HubPane = {
  id: "images",
  section: "project",
  label: "Images",
  order: 30,
  minRole: "viewer",
  Content: Images,
};
