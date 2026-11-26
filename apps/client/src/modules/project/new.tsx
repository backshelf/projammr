import { PAGE } from "@workspace/ui/lib/shell";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { ProjectForm } from "@/components/forms/ProjectForm";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { NEW_PROJECT_HREF } from "@/lib/utils";
import { ScrollRoot } from "@workspace/ui/components/layout/scroll-root";

export default async function NewProject() {
  return (
    <ScrollRoot className={PAGE}>
      <PageHead
        crumbs={
          <Breadcrumbs
            crumbs={[{ label: "New project", href: NEW_PROJECT_HREF }]}
          />
        }
        title={"New project"}
        lede={
          "A project is an artist or a band — the home for its collections, tracks and sessions."
        }
      />
      <ProjectForm />
    </ScrollRoot>
  );
}
