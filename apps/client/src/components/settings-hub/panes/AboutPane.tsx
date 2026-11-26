import { getInstance } from "@/actions/instance";
import { AdminAboutSection } from "@/components/admin/AdminAboutSection";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane } from "./types";

async function About() {
  const instance = await getInstance();
  if (isActionError(instance)) {
    return <p className="text-small text-ink-soft">{instance.error}</p>;
  }
  return (
    <AdminAboutSection
      version={instance.version}
      updateCheck={instance.updateCheck}
    />
  );
}

/** The version the instance runs, and whether a newer one is out. */
export const AboutPane: HubPane = {
  id: "about",
  section: "instance",
  label: "About",
  order: 40,
  Content: About,
};
