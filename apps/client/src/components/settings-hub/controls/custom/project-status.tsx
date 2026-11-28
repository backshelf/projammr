"use client";

import { getStatuses } from "@/actions/statuses";
import { isActionError } from "@workspace/api/lib/action-result";
import type { Status } from "@workspace/api/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useEffect, useState } from "react";
import { useHub } from "../../hub-rows";
import { describedByOf, type CustomSettingControl } from "../types";

/** The picker's own value for "none chosen", the schema's `null`. */
const NONE = "none";

/**
 * A single select of the project's statuses, fetched once. A stored id the
 * project no longer has — the status was deleted — shows a notice, so the
 * row is where that gets fixed rather than the value silently pointing at
 * nothing.
 */
export const ProjectStatusControl: CustomSettingControl = ({
  value,
  onChange,
  disabled,
  id,
}) => {
  const { projectId } = useHub();
  const selected = typeof value === "number" ? value : null;
  const [loaded, setLoaded] = useState<{
    projectId: number;
    statuses: Status[] | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (projectId === null) return;
    let current = true;
    void getStatuses(projectId).then((result) => {
      if (!current) return;
      if (isActionError(result)) {
        setLoaded({ projectId, statuses: null, error: result.error });
      } else {
        setLoaded({ projectId, statuses: result, error: null });
      }
    });
    return () => {
      current = false;
    };
  }, [projectId]);

  const current = loaded?.projectId === projectId ? loaded : null;
  const statuses = current?.statuses ?? null;
  const loadError = current?.error ?? null;

  const stale =
    selected !== null &&
    statuses !== null &&
    !statuses.some((status) => status.id === selected);

  // The keys' schema takes a status id, never `null`: "None" is listed only so
  // a value that somehow holds `null` still renders, never as a choice to make.
  const items = [
    ...(selected === null ? [{ value: NONE, label: "None" }] : []),
    ...(statuses ?? []).map((status) => ({
      value: String(status.id),
      label: status.name,
    })),
    ...(stale ? [{ value: String(selected), label: "Not available" }] : []),
  ];

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Select
        value={selected === null ? NONE : String(selected)}
        onValueChange={(next) => onChange(next === NONE ? null : Number(next))}
        disabled={disabled || statuses === null}
        items={items}
      >
        <SelectTrigger
          id={id}
          className="w-48"
          aria-describedby={describedByOf(id)}
        >
          <SelectValue
            placeholder={
              statuses === null ? (loadError ?? "Loading statuses…") : undefined
            }
          />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {stale && (
        <p className="max-w-[36ch] text-right text-small text-pretty text-ink-soft">
          Status no longer exists. Choose another.
        </p>
      )}
      {loadError !== null && (
        <p role="alert" className="text-right text-small text-danger">
          {loadError}
        </p>
      )}
    </div>
  );
};
