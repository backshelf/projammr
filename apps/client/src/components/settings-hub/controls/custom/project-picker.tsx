"use client";

import { clientGetMyProjects } from "@/lib/client-api";
import { isActionError } from "@workspace/api/lib/action-result";
import type { MyProject } from "@workspace/api/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useEffect, useState } from "react";
import { describedByOf, type CustomSettingControl } from "../types";

/** The picker's own value for "none chosen", the schema's `null`. */
const NONE = "none";

/**
 * Which of the caller's own projects "Landing page" opens to when it names a
 * chosen project. The list is fetched once, the same read a mover dialog
 * uses. A stored id no longer among them — the project was left or deleted —
 * shows a notice: this row is where that gets fixed, rather than the landing
 * redirect silently falling back to the projects list with nothing to explain
 * why.
 */
export const ProjectPickerControl: CustomSettingControl = ({
  value,
  onChange,
  disabled,
  id,
}) => {
  const selected = typeof value === "number" ? value : null;
  const [projects, setProjects] = useState<MyProject[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void clientGetMyProjects().then((result) => {
      if (!current) return;
      if (isActionError(result)) setLoadError(result.error);
      else setProjects(result);
    });
    return () => {
      current = false;
    };
  }, []);

  const stale =
    selected !== null &&
    projects !== null &&
    !projects.some((project) => project.id === selected);

  const items = [
    { value: NONE, label: "None" },
    ...(projects ?? []).map((project) => ({
      value: String(project.id),
      label: project.name,
    })),
    ...(stale ? [{ value: String(selected), label: "Not available" }] : []),
  ];

  return (
    <div className="flex flex-col items-end gap-1.5">
      <Select
        value={selected === null ? NONE : String(selected)}
        onValueChange={(next) => onChange(next === NONE ? null : Number(next))}
        disabled={disabled || projects === null}
        items={items}
      >
        <SelectTrigger
          id={id}
          className="w-48"
          aria-describedby={describedByOf(id)}
        >
          <SelectValue
            placeholder={
              projects === null ? (loadError ?? "Loading projects…") : undefined
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
          You’re no longer in this project, so Landing page falls back to the
          projects list until you choose another.
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
