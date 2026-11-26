"use client";

import { ColourList } from "@/components/settings/ColourList";
import { LabelItem } from "@/components/settings/LabelItem";
import SettingsLabelForm from "@/components/settings/SettingsLabelForm";
import { useProjectRole } from "@/hooks/use-project-role";
import type { Label } from "@workspace/api/api";

export function SettingsLabels({
  projectId,
  labels,
}: {
  projectId: number;
  labels: Label[];
}) {
  const canEdit = useProjectRole()?.can("editor") ?? false;

  return (
    <ColourList
      heading="LABELS"
      noun="label"
      canEdit={canEdit}
      empty={labels.length === 0}
      renderAddForm={(close) => (
        <SettingsLabelForm projectId={projectId} mode="create" onDone={close} />
      )}
    >
      {labels.map((label) => (
        <LabelItem
          key={label.id}
          label={label}
          projectId={projectId}
          canEdit={canEdit}
        />
      ))}
    </ColourList>
  );
}
