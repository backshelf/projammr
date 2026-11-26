import { getAssetsForProject } from "@/actions/assets";
import { getProjectStorage } from "@/actions/storage";
import { ProjectRepos } from "@/components/settings/ProjectRepos";
import { DuplicateAudioAudit } from "@/components/settings/DuplicateAudioAudit";
import { SettingsStorage } from "@/components/settings/SettingsStorage";
import { AssetsTable } from "@/components/tables/AssetsTable";
import { FileUploader } from "@/components/uploads/FileUploader";
import { cachedFormatters } from "@/lib/formatters";
import { parseTableQuery } from "@/lib/table-params";
import { isActionError } from "@workspace/api/lib/action-result";
import { Separator } from "@workspace/ui/components/separator";
import { Suspense } from "react";
import type { HubPane, HubPaneProps } from "./types";

async function Assets({ project, searchParams }: HubPaneProps) {
  if (!project) return null;
  const query = parseTableQuery(searchParams);
  const [result, storage, format] = await Promise.all([
    getAssetsForProject(project.id, { page: 1, q: query.q, sort: query.sort }),
    getProjectStorage(project.id),
    cachedFormatters(),
  ]);

  return (
    <div className="space-y-4">
      {!isActionError(storage) && (
        <SettingsStorage storage={storage} format={format} />
      )}
      <Suspense fallback={null}>
        <ProjectRepos projectId={project.id} format={format} />
      </Suspense>
      <FileUploader />
      <DuplicateAudioAudit projectId={project.id} />
      <Separator />
      <AssetsTable
        assets={isActionError(result) ? [] : result.rows}
        rowCount={isActionError(result) ? 0 : result.rowCount}
        projectId={project.id}
      />
    </div>
  );
}

/** The project's storage, its uploads and every file it holds. */
export const AssetsPane: HubPane = {
  id: "assets",
  section: "project",
  label: "Assets",
  order: 40,
  minRole: "viewer",
  Content: Assets,
};
