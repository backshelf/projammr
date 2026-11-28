"use client";

import { getLabels } from "@/actions/labels";
import { isActionError } from "@workspace/api/lib/action-result";
import type { Label } from "@workspace/api/api";
import { IconX } from "@tabler/icons-react";
import { IconButton } from "@workspace/ui/components/icon-button";
import { useEffect, useState } from "react";
import { useHub } from "../../hub-rows";
import { MultiselectPills } from "../MultiselectControl";
import { describedByOf, labelIdOf, type CustomSettingControl } from "../types";

/**
 * A multi-select of the project's labels, fetched once. An id the project no
 * longer has — the label was deleted — is listed on its own with a way to
 * take it away, rather than silently dropped from the value.
 */
export const ProjectLabelsControl: CustomSettingControl = ({
  value,
  onChange,
  disabled,
  id,
}) => {
  const { projectId } = useHub();
  const chosen = Array.isArray(value) ? (value as number[]) : [];
  const [loaded, setLoaded] = useState<{
    projectId: number;
    labels: Label[] | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (projectId === null) return;
    let current = true;
    void getLabels(projectId).then((result) => {
      if (!current) return;
      if (isActionError(result)) {
        setLoaded({ projectId, labels: null, error: result.error });
      } else {
        setLoaded({ projectId, labels: result, error: null });
      }
    });
    return () => {
      current = false;
    };
  }, [projectId]);

  const current = loaded?.projectId === projectId ? loaded : null;
  const labels = current?.labels ?? null;
  const loadError = current?.error ?? null;

  const knownIds = new Set((labels ?? []).map((label) => label.id));
  const staleIds = chosen.filter((each) => !knownIds.has(each));

  return (
    <div className="flex flex-col items-end gap-1.5">
      <MultiselectPills
        id={id}
        aria-labelledby={labelIdOf(id)}
        aria-describedby={describedByOf(id)}
        options={(labels ?? []).map((label) => ({
          value: String(label.id),
          label: label.name,
        }))}
        value={chosen
          .filter((each) => knownIds.has(each))
          .map((each) => String(each))}
        onChange={(next) =>
          onChange([...next.map((each) => Number(each)), ...staleIds])
        }
        disabled={disabled || labels === null}
      />
      {staleIds.length > 0 && (
        <ul className="flex flex-col items-end gap-1">
          {staleIds.map((each) => (
            <li key={each} className="flex items-center gap-1.5">
              <span className="text-small text-pretty text-ink-soft">
                Label no longer exists
              </span>
              <IconButton
                disabled={disabled}
                aria-label="Remove the label"
                onClick={() => onChange(chosen.filter((id) => id !== each))}
              >
                <IconX aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {loadError !== null && (
        <p role="alert" className="text-right text-small text-danger">
          {loadError}
        </p>
      )}
    </div>
  );
};
