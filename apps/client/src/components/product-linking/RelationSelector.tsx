"use client";

import { getRelationTypes } from "@/actions/relation-types";
import { getTrackSummaries } from "@/actions/tracks";
import { addTrackRelation } from "@/entities/mutations";
import { AppLink } from "@/components/navigation/AppLink";
import { useMutate } from "@/hooks/use-mutate";
import { settingsHref } from "@/lib/settings/href";
import { ArchivedFlag } from "@/components/track/ArchivedFlag";
import { useProject } from "@/hooks/use-project-role";
import type { RelationTypeEntry, TrackSummary } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { EntityPicker, PickerDetail, type PickerLoad } from "./EntityPicker";

/**
 * The eight seeded types' "to" wording, keyed by their lower-cased name. A
 * type outside this set reads "has `<name>`".
 */
const SEEDED_INVERSE_VERBS: Record<string, string> = {
  remix: "remixed by",
  remaster: "remastered by",
  rework: "reworked by",
  edit: "edited by",
  "live version": "performed live by",
  cover: "covered by",
  instrumental: "instrumental by",
  acoustic: "acoustic by",
};

/** The verb of a "from" edge: this track is a `<name> of` the other track. */
export function relationVerb(name: string): string {
  return `${name} of`;
}

/**
 * The verb of a "to" edge: the other track derives from this one. Keeps
 * today's wording for one of the eight seeded names, matched case-
 * insensitively; any other name reads "has `<name>`".
 */
export function inverseRelationVerb(name: string): string {
  return SEEDED_INVERSE_VERBS[name.toLowerCase()] ?? `has ${name}`;
}

/** How a "from" edge reads: this track is a `<name> of` the other track. */
export function relationLabel(name: string, title: string): string {
  return `${relationVerb(name)} ${title}`;
}

/** How a "to" edge reads: this track is the source the other one derives from. */
export function inverseRelationLabel(name: string, title: string): string {
  return `${inverseRelationVerb(name)} ${title}`;
}

/** Picks one of the project's relation types, then the track this one derives from. */
export function RelationSelector({ trackId }: { trackId: number }) {
  const { id: projectId } = useProject();
  // Null while the types load; the message when the fetch failed.
  const [types, setTypes] = useState<RelationTypeEntry[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [typeId, setTypeId] = useState<number | null>(null);
  const mutate = useMutate();

  useEffect(() => {
    let cancelled = false;
    void getRelationTypes(projectId).then((result) => {
      if (cancelled) return;
      if (isActionError(result)) {
        setFailure(result.error);
        return;
      }
      setFailure(null);
      setTypes(result);
      setTypeId((current) => current ?? result[0]?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const load = useCallback<PickerLoad<TrackSummary>>(async () => {
    const result = await getTrackSummaries(projectId);
    return isActionError(result) ? result : { items: result };
  }, [projectId]);

  const selectedType = types?.find((t) => t.id === typeId);

  if (failure !== null) {
    return (
      <p role="alert" className="py-6 text-center text-small text-danger">
        {failure}
      </p>
    );
  }

  if (types?.length === 0) {
    return (
      <p className="py-6 text-center text-small text-ink-soft">
        This project has no relation types.{" "}
        <AppLink
          href={settingsHref({
            section: "project",
            projectId,
            group: "relation-types",
          })}
          className="text-ink underline underline-offset-2"
        >
          Add one in Settings
        </AppLink>
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-small text-ink-soft">
        <span className="shrink-0">This track is a</span>
        <Select
          disabled={types === null}
          value={typeId != null ? String(typeId) : ""}
          onValueChange={(v) => setTypeId(Number(v))}
          items={(types ?? []).map((t) => ({
            value: String(t.id),
            label: t.name,
          }))}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(types ?? []).map((t) => (
              <SelectItem key={t.id} value={String(t.id)}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="shrink-0">of…</span>
      </div>

      <EntityPicker
        load={load}
        exclude={(t) => t.id === trackId}
        matches={(t, q) =>
          t.title.toLowerCase().includes(q) ||
          (t.artists ?? []).some((a) => a.toLowerCase().includes(q))
        }
        renderRow={(t) => (
          <>
            <span className="min-w-0 truncate font-medium">{t.title}</span>
            {t.archivedAt && <ArchivedFlag />}
            {(t.artists?.length ?? 0) > 0 && (
              <PickerDetail>{t.artists.join(", ")}</PickerDetail>
            )}
          </>
        )}
        placeholder="Search tracks by title or artist…"
        emptyLabel="No other tracks in this project."
        onPick={async (target) => {
          if (!selectedType) return false;
          const result = await mutate(
            addTrackRelation(trackId, target.id, selectedType.id)
          );
          if (isActionError(result)) {
            toast.error(result.error);
            return false;
          }
          toast.success(
            `This track is now a ${selectedType.name} of "${target.title}"`
          );
          return true;
        }}
      />
    </div>
  );
}
