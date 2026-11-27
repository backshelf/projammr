"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { getContrastColour } from "@/lib/css-utils";
import { setEntityLabels } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { useProject } from "@/hooks/use-project-role";
import { settingsHref } from "@/lib/settings/href";
import { withFilters } from "@/lib/table-params";
import { IconPlus, IconTag } from "@tabler/icons-react";
import type { Label, TableEntityKind } from "@workspace/api/api";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Separator } from "@workspace/ui/components/separator";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { isActionError } from "@workspace/api/lib/action-result";

import { OverflowChipList } from "./OverflowChipList";

// One identity for the absent case, so the memos below actually memoise.
const NO_LABELS: Label[] = [];

function LabelBadge({
  label,
  href,
}: {
  label: Label;
  /** Makes the badge a link. */
  href?: string;
}) {
  // The resolved theme, not the OS preference: reading `matchMedia` during
  // render both ignores an explicit light/dark choice and renders differently
  // on the server, which breaks hydration.
  const style = {
    backgroundColor: label.colourHex,
    color: getContrastColour(label.colourHex),
  };
  return href ? (
    <Badge asChild style={style} className="motion-ink hover:opacity-80">
      <AppLink href={href}>{label.name}</AppLink>
    </Badge>
  ) : (
    <Badge style={style}>{label.name}</Badge>
  );
}

/**
 * A table cell that shows an entity's labels as coloured badges and, on click,
 * opens a picker over the project's label vocabulary. Toggling an option or
 * typing a new name writes the entity's full label set through the API.
 */
export function LabelsCell({
  entityType,
  entityId,
  labels,
  projectLabels,
  listHref,
}: {
  entityType: TableEntityKind;
  entityId: number;
  /** Absent on a hierarchy sub-row whose parent list query didn't hydrate it. */
  labels?: Label[];
  projectLabels?: Label[];
  /** A list page that filters by label; each badge links to it narrowed to its own label. */
  listHref?: string;
}) {
  const mutate = useMutate();
  const { id: projectId, can } = useProject();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const rowLabels = labels ?? NO_LABELS;
  const vocabulary = projectLabels ?? NO_LABELS;

  const selectedIds = useMemo(
    () => new Set(rowLabels.map((l) => l.id)),
    [rowLabels]
  );

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    return q
      ? vocabulary.filter((l) => l.name.toLowerCase().includes(q))
      : vocabulary;
  }, [vocabulary, draft]);

  const exactMatch = vocabulary.some(
    (l) => l.name.toLowerCase() === draft.trim().toLowerCase()
  );

  async function commit(input: { labelIds?: number[]; names?: string[] }) {
    setSaving(true);
    const result = await mutate(setEntityLabels(entityType, entityId, input));
    setSaving(false);
    if (isActionError(result)) {
      toast.error(`Failed to update labels: ${result.error}`);
    }
  }

  function toggle(id: number) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    commit({ labelIds: [...next] });
  }

  function addNew() {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    commit({ labelIds: [...selectedIds], names: [name] });
  }

  return (
    <OverflowChipList
      items={rowLabels}
      maxVisible={2}
      getKey={(label) => label.id}
      overflowLabel="labels"
      renderItem={(label) => (
        <LabelBadge
          label={label}
          href={listHref && withFilters(listHref, { label: label.id })}
        />
      )}
      trailing={
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="Edit labels"
              className="size-6 shrink-0"
            >
              {rowLabels.length ? (
                <IconPlus size={14} />
              ) : (
                <IconTag size={14} />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Filter or create…"
              className="mb-2 h-7 text-small"
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim() && !exactMatch) addNew();
              }}
            />
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {filtered.map((label) => (
                <button
                  key={label.id}
                  type="button"
                  disabled={saving}
                  onClick={() => toggle(label.id)}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-small hover:bg-ink/4 disabled:opacity-50"
                >
                  <span
                    aria-hidden
                    className="size-3 shrink-0 rounded-full border"
                    style={{
                      backgroundColor: selectedIds.has(label.id)
                        ? label.colourHex
                        : "transparent",
                      borderColor: label.colourHex,
                    }}
                  />
                  <span className="truncate">{label.name}</span>
                </button>
              ))}
              {draft.trim() && !exactMatch && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={addNew}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-small hover:bg-ink/4 disabled:opacity-50"
                >
                  <IconPlus size={14} />
                  Create “{draft.trim()}”
                </button>
              )}
              {filtered.length === 0 && !draft.trim() && (
                <p className="px-1.5 py-1 text-small text-ink-soft">
                  No labels yet.
                </p>
              )}
            </div>
            {/* Renaming, recolouring and deleting labels is an editor's. */}
            {can("editor") && (
              <>
                <Separator className="my-2" />
                <AppLink
                  href={settingsHref({
                    section: "project",
                    projectId,
                    group: "labels",
                  })}
                  className="block rounded px-1.5 py-1 text-small text-ink-soft hover:bg-ink/4"
                >
                  Manage labels
                </AppLink>
              </>
            )}
          </PopoverContent>
        </Popover>
      }
    />
  );
}
