import { cachedProject, cachedRepo } from "@/lib/server-data";
import { parseTableQuery } from "@/lib/table-params";
import ProjectPage from "@/modules/project/page";
import PluginsPage from "@/modules/project/plugins";
import RepoPage from "@/modules/project/repo";
import SamplesPage from "@/modules/project/samples";
import { flagOr, routeModule } from "@/modules/route-module";
import { isActionError } from "@workspace/api/lib/action-result";

export const projectRoutes = {
  project: routeModule<"project">({
    loadTitle: async ({ projectId }) => {
      const project = await cachedProject(projectId);
      return isActionError(project) ? undefined : project.name;
    },
    Page: ({ route, searchParams }) => (
      <ProjectPage
        projectId={route.projectId}
        query={parseTableQuery(searchParams)}
        library={flagOr(searchParams.library, undefined)}
      />
    ),
  }),
  plugins: routeModule<"plugins">({
    title: "Plugins",
    Page: ({ route, searchParams }) => (
      <PluginsPage projectId={route.projectId} searchParams={searchParams} />
    ),
  }),
  repo: routeModule<"repo">({
    loadTitle: async ({ repoId }) => {
      const repo = await cachedRepo(repoId);
      return isActionError(repo) ? undefined : repo.name;
    },
    Page: ({ route }) => (
      <RepoPage projectId={route.projectId} repoId={route.repoId} />
    ),
  }),
  samples: routeModule<"samples">({
    title: "Samples",
    Page: ({ route, searchParams }) => (
      <SamplesPage projectId={route.projectId} searchParams={searchParams} />
    ),
  }),
};
