"use client";

import type { NewRowConfig } from "@/components/tables/DraftRow";
import type {
  EditableCellConfig,
  FilterColumnConfig,
  FilterPreset,
} from "@/components/tables/generic-table-types";
import { draftFieldsFrom } from "@/components/tables/new-row";
import type { PeekField, PeekRow } from "@/components/tables/PeekPanel";
import { priorityFilterColumn } from "@/components/tables/Priority";
import { sessionFromDraft } from "@/components/tables/session-draft";
import { createEntity } from "@/entities/mutations";
import { pageQueryOf } from "@/entities/session/api";
import type { EntityTableDefinition } from "@/entities/table-types";
import { useMutate } from "@/hooks/use-mutate";
import type { ListSession } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Formatted } from "@workspace/ui/components/format-provider";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";

import { inDitLabel, sessionColumns, sessionHref } from "./columns";
import { dawSuggestions } from "./daw-suggestions";

/** The ids the session peek row gives its fields — what a card's `keyFields`
 *  may name. */
type SessionPeekFieldId =
  | "daw"
  | "track"
  | "tempo"
  | "key"
  | "timeSignature"
  | "tracksCount"
  | "scenesCount"
  | "dawVersion"
  | "localFilepath";

/** The card's meta line: the DAW and the parent track. A session's counts mean
 *  little without the file open. */
const SESSION_CARDS: { keyFields: SessionPeekFieldId[] } = {
  keyFields: ["daw", "track"],
};

export const sessionTable = {
  kind: "session",
  identityField: "name",
  href: (row, projectId, scope) =>
    sessionHref(row, projectId, scope?.collectionId),
  pageQuery: pageQueryOf,
  toPeekRow: (row) => {
    const fields: (PeekField & { id: SessionPeekFieldId })[] = [
      { id: "daw", label: "DAW", value: row.dawName ?? row.daw },
      { id: "track", label: "Track", value: row.track?.title ?? null },
      {
        id: "tempo",
        label: "Tempo",
        value: row.tempo && (
          <Formatted>{(format) => format.tempo(row.tempo!)}</Formatted>
        ),
      },
      {
        id: "key",
        label: "Key",
        value: (row.rootNote || row.scale) && (
          <Formatted>
            {(format) => format.key(row.rootNote, row.scale)}
          </Formatted>
        ),
      },
      { id: "timeSignature", label: "Time", value: row.timeSignature },
      { id: "tracksCount", label: "Tracks", value: row.tracksCount },
      { id: "scenesCount", label: "Scenes", value: row.scenesCount },
      { id: "dawVersion", label: "Version", value: row.dawVersion },
      {
        id: "localFilepath",
        label: "File",
        value: row.localFilepath,
        mono: true,
        span: 3,
      },
    ];
    return {
      id: row.id,
      title: row.name,
      subtitle: row.dawName ?? row.daw,
      flag: row.main ? "Main" : undefined,
      priority: row.priority,
      fields,
    } satisfies PeekRow;
  },
  useParts: ({ projectId, projectLabels, priorityLevels, embedded, scope }) => {
    const { collectionId, trackId, tracks, daws, machines } = scope;
    const mutate = useMutate();

    const columns = useMemo(
      () => sessionColumns(projectId, projectLabels, collectionId, machines),
      [projectId, projectLabels, collectionId, machines]
    );

    const editableCells: Record<string, EditableCellConfig> = useMemo(
      () => ({
        dawName: {
          type: "suggest",
          placeholder: "DAW",
          suggestions: dawSuggestions(daws),
        },
        priority: { type: "priority", priorityLevels },
      }),
      [daws, priorityLevels]
    );

    const filterColumns: FilterColumnConfig[] = useMemo(
      () => [
        {
          id: "daw",
          label: "DAW",
          param: "daw",
          options: daws.map((d) => ({
            value: d.daw,
            label: d.dawName ?? d.daw,
          })),
        },
        {
          id: "track",
          label: "Track",
          param: "track",
          options: tracks.map((t) => ({
            value: String(t.id),
            label: t.title,
          })),
        },
        priorityFilterColumn(priorityLevels),
        {
          id: "inDit",
          label: "In dit",
          param: "inDit",
          options: [
            { value: "true", label: inDitLabel(true) },
            { value: "false", label: inDitLabel(false) },
          ],
        },
        {
          id: "unassigned",
          label: "Track link",
          param: "unassigned",
          counted: false,
          options: [
            { value: "true", label: "Unassigned" },
            { value: "false", label: "Assigned" },
          ],
        },
      ],
      [tracks, daws, priorityLevels]
    );

    const filterPresets: FilterPreset[] | undefined = useMemo(
      (): FilterPreset[] | undefined =>
        embedded || trackId != null
          ? undefined
          : [
              { id: "all", label: "All", params: {} },
              {
                id: "unassigned",
                label: "Unassigned",
                params: { unassigned: "true" },
              },
              {
                id: "not-in-dit",
                label: "Not in dit",
                params: { inDit: "false" },
              },
            ],
      [embedded, trackId]
    );

    const initiallyHiddenColumns = useMemo(
      () =>
        embedded
          ? ["id", "createdAt", "track", "collection"]
          : ["id", "createdAt"],
      [embedded]
    );

    const newRow: NewRowConfig = useMemo(
      () => ({
        entityLabel: "session",
        fields: {
          ...draftFieldsFrom(
            editableCells,
            ["name", "dawName", "priority"],
            // The identity column is a link, not an editable cell, so its
            // draft input is declared here.
            {
              name: {
                type: "text",
                placeholder: "Session name",
                required: true,
              },
            }
          ),
          // Never a visible column of its own; rendered (locked) only when a
          // DAW group header opens its "+ Add" row, seeding that DAW's id.
          daw: { type: "text" },
          // Never a visible column; rendered (locked) only when a Track group
          // header opens its "+ Add" row.
          trackId: { type: "number" },
        },
        groupSeed: (groupParam, groupKey) => {
          if (groupParam === "daw") return { field: "daw", value: groupKey };
          if (groupParam === "priority")
            return { field: "priority", value: Number(groupKey) };
          if (groupParam === "track")
            return { field: "trackId", value: Number(groupKey) };
          return null;
        },
        onCreate: async (draft) => {
          const result = await mutate(
            createEntity("session", sessionFromDraft(draft, projectId, trackId))
          );
          if (isActionError(result)) {
            toast.error(`Failed to create session: ${result.error}`);
            return false;
          }
          // The list rows carry a joined track object the create response
          // lacks, so the default `createEntity` refresh refetches rather than
          // splicing in a partial row.
          toast.success(`Created "${String(draft.name)}"`);
          return true;
        },
      }),
      [editableCells, projectId, trackId, mutate]
    );

    const groupByOptions = useMemo(
      () => [
        { id: "daw", label: "DAW", filterParam: "daw" },
        { id: "priority", label: "Priority", filterParam: "priority" },
        { id: "track", label: "Track", filterParam: "track" },
      ],
      []
    );

    const getRowGroupKey = useCallback((row: ListSession, groupKey: string) => {
      if (groupKey === "priority") return String(row.priority.id);
      if (groupKey === "track")
        return row.track?.id != null ? String(row.track.id) : null;
      return row.daw ?? null;
    }, []);

    return {
      columns,
      editableCells,
      filterColumns,
      filterPresets,
      newRow,
      groupByOptions,
      getRowGroupKey,
      cards: SESSION_CARDS,
      initiallyHiddenColumns,
    };
  },
} satisfies EntityTableDefinition<"session">;
