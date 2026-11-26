"use client";

import { ColourList } from "@/components/settings/ColourList";
import SettingsStatusForm from "@/components/settings/SettingsStatusForm";
import { StatusItem } from "@/components/settings/StatusItem";
import { useProjectRole } from "@/hooks/use-project-role";
import type { Status } from "@workspace/api/api";

export function SettingsStatuses({
  projectId,
  statuses,
}: {
  projectId: number;
  statuses: Status[];
}) {
  const canEdit = useProjectRole()?.can("editor") ?? false;

  return (
    <ColourList
      heading="STATUSES"
      noun="status"
      canEdit={canEdit}
      empty={statuses.length === 0}
      renderAddForm={(close) => (
        <SettingsStatusForm
          projectId={projectId}
          mode="create"
          onDone={close}
        />
      )}
    >
      {[...statuses]
        .sort((a, b) => a.percentage - b.percentage)
        .map((status) => (
          <StatusItem
            key={status.id}
            status={status}
            projectId={projectId}
            canEdit={canEdit}
          />
        ))}
    </ColourList>
  );
}
