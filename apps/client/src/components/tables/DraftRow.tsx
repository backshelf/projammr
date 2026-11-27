"use client";

import { fieldKind } from "@/fields";
import { FloatingFieldError } from "@/fields/input";
import type { FieldKind } from "@/fields/types";
import { IconPlus } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { PINNED_CELL, TableCell } from "@workspace/ui/components/table";
import { FADE, LEAVE } from "@workspace/ui/lib/motion";
import { cn } from "@workspace/ui/lib/utils";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { MotionTableRow } from "./motion-row";
import {
  type CoercedDraft,
  type DraftValues,
  type NewRowFieldConfig,
  validateDraft,
} from "./new-row";

/** The first control a draft input renders, whichever kind it belongs to. */
const FIRST_CONTROL = 'input, button, [role="combobox"], [tabindex="0"]';

export type NewRowConfig = {
  /** Draft input columns, keyed by column id. */
  fields: Record<string, NewRowFieldConfig>;
  /**
   * Persist a new row. Receives the parsed draft keyed by column id; a status
   * field arrives as a numeric id and a blank optional field as null. Returns
   * whether creation succeeded so the row can clear itself.
   */
  onCreate: (draft: CoercedDraft) => Promise<boolean>;
  /**
   * Raw drafts, keyed by column id, that a draft row starts with: shown and
   * editable, and sent unless the user clears them. The unlocked sibling of a
   * group seed, which still wins for its own field.
   */
  defaults?: DraftValues;
  /** Noun for the create button's accessible name ("Create track"). */
  entityLabel?: string;
  /**
   * Maps an active grouping (the `group` query param) and one group's key to
   * the draft field it seeds and the coerced value to lock it at, so a "+ Add"
   * under that group's header creates a row already in the group. Return `null`
   * for groupings that can't seed a create (e.g. a many-to-many label group).
   */
  groupSeed?: (
    groupParam: string,
    groupKey: string
  ) => { field: string; value: string | number | boolean } | null;
};

/**
 * One draft input: its kind's `DraftInput`, the wrapper that owns what every
 * kind shares (the row's keys, being disabled, first-field focus) and the
 * field's error. A disabled field is inert, so a picker that is not a native
 * control is shut too.
 */
function DraftField({
  kind: { DraftInput },
  config,
  raw,
  error,
  disabled,
  autoFocus,
  onChange,
  onKeyDown,
}: {
  kind: FieldKind;
  config: NewRowFieldConfig;
  raw: string;
  error?: string;
  disabled: boolean;
  autoFocus: boolean;
  onChange: (raw: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoFocus)
      ref.current?.querySelector<HTMLElement>(FIRST_CONTROL)?.focus();
  }, [autoFocus]);

  return (
    <div className="relative flex items-center">
      <div
        ref={ref}
        inert={disabled}
        className={cn("w-full", disabled && "opacity-50")}
        onKeyDown={onKeyDown}
      >
        <DraftInput
          id={id}
          raw={raw}
          config={config}
          onChange={onChange}
          invalid={error !== undefined}
        />
      </div>
      {error && <FloatingFieldError message={error} />}
    </div>
  );
}

/**
 * The bottom row for creating an entity inline. Renders an
 * editor in each column named by `config.fields` and an empty cell elsewhere,
 * with the create button beside the last field input. Enter in any field
 * submits; a field that fails its kind's parse is marked and says why.
 */
export function DraftRow({
  config,
  columnIds,
  initialValues = {},
  lockedFields = [],
  onCreated,
  onCancel,
  autoFocus = false,
  pinnedColumnId,
}: {
  config: NewRowConfig;
  /** Visible column ids, in render order. */
  columnIds: string[];
  /** Identity column, pinned while the grid scrolls sideways. */
  pinnedColumnId?: string;
  /**
   * Coerced values seeding fields the user has not filled — a group-header
   * draft row pre-filled with that group's value. A seeded field passes the
   * required check.
   */
  initialValues?: CoercedDraft;
  /**
   * Field ids the user cannot edit: the seed always wins and the input renders
   * disabled. Used for a group-header row's grouping field.
   */
  lockedFields?: readonly string[];
  /** Called after a successful create (a group row collapses itself). */
  onCreated?: () => void;
  /** Called when Escape is pressed in a field. */
  onCancel?: () => void;
  /** Focus the first field as the row mounts — when it was opened on request. */
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState<DraftValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const locked = useMemo(() => new Set(lockedFields), [lockedFields]);
  // What each field holds: the row's defaults until the user types over them.
  const shownDraft = useMemo(
    () => ({ ...config.defaults, ...draft }),
    [config.defaults, draft]
  );

  const setField = useCallback(
    (id: string, value: string) => {
      if (locked.has(id)) return;
      setDraft((prev) => ({ ...prev, [id]: value }));
      setErrors((prev) =>
        Object.fromEntries(Object.entries(prev).filter(([key]) => key !== id))
      );
    },
    [locked]
  );

  // A draft sends what it shows: a field whose column is hidden is left out of
  // the create, unless a group header seeded it. A hidden checkbox would
  // otherwise write an unticked box the user never saw.
  const shownFields = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(config.fields).filter(
          ([id]) => columnIds.includes(id) || initialValues[id] !== undefined
        )
      ),
    [config.fields, columnIds, initialValues]
  );

  const submit = useCallback(async () => {
    const result = validateDraft(
      shownFields,
      shownDraft,
      initialValues,
      lockedFields
    );
    if (!result.ok) {
      setErrors(
        Object.fromEntries(result.errors.map((e) => [e.field, e.error]))
      );
      toast.error(
        result.errors.length === 1
          ? "Fix the highlighted field"
          : "Fix the highlighted fields"
      );
      return;
    }

    setIsSaving(true);
    try {
      const ok = await config.onCreate(result.value);
      if (ok) {
        setDraft({});
        setErrors({});
        onCreated?.();
      }
    } finally {
      setIsSaving(false);
    }
  }, [config, shownFields, shownDraft, initialValues, lockedFields, onCreated]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      // A popup is portaled out of its field, but React still bubbles its keys
      // through it; they belong to the popup.
      if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) {
        return;
      }
      // The draft row sits inside the element holding the grid's own key
      // handler, which reads a key on anything but a text box as a gesture on
      // the focused cell. A picker's trigger is a button, so Enter on the
      // priority or status field would open an editor on some unrelated cell
      // behind the row. Every key the row's own controls see is the row's.
      e.stopPropagation();
      // Enter on a picker's trigger opens it, so only a text box submits.
      if (
        e.key === "Enter" &&
        !e.shiftKey &&
        e.target instanceof HTMLInputElement
      ) {
        e.preventDefault();
        void submit();
      } else if (e.key === "Escape" && onCancel) {
        e.preventDefault();
        onCancel();
      }
    },
    [submit, onCancel]
  );

  const lastFieldColumn = useMemo(() => {
    const fieldColumns = columnIds.filter((id) => config.fields[id]);
    return fieldColumns[fieldColumns.length - 1];
  }, [columnIds, config.fields]);

  const firstFieldColumn = columnIds.find(
    (id) => config.fields[id] && !locked.has(id)
  );

  const renderField = (id: string) => {
    const isLocked = locked.has(id);
    const seeded = initialValues[id];
    return (
      <DraftField
        kind={fieldKind(config.fields[id]!.type)}
        config={config.fields[id]!}
        raw={
          isLocked
            ? seeded != null
              ? String(seeded)
              : ""
            : (shownDraft[id] ?? "")
        }
        error={errors[id]}
        disabled={isLocked || isSaving}
        autoFocus={autoFocus && id === firstFieldColumn}
        onChange={(value) => setField(id, value)}
        onKeyDown={onKeyDown}
      />
    );
  };

  return (
    // A row is a rectangle of text, so it travels by position alone: the rows
    // it pushes down move with it, and nothing is scaled on the way.
    <MotionTableRow
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: FADE.quick }}
      exit={{ opacity: 0, transition: LEAVE.quick }}
    >
      {columnIds.map((id) =>
        config.fields[id] ? (
          <TableCell
            key={id}
            className={cn(
              "overflow-visible",
              errors[id] && "relative z-20",
              id === pinnedColumnId && PINNED_CELL
            )}
          >
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1">{renderField(id)}</span>
              {id === lastFieldColumn && (
                <Button
                  size="icon-sm"
                  disabled={isSaving}
                  onClick={submit}
                  aria-label={
                    config.entityLabel
                      ? `Create ${config.entityLabel}`
                      : "Create row"
                  }
                  className="shrink-0"
                >
                  {isSaving ? <Spinner /> : <IconPlus size={14} />}
                </Button>
              )}
            </div>
          </TableCell>
        ) : (
          <TableCell
            key={id}
            className={id === pinnedColumnId ? PINNED_CELL : undefined}
          />
        )
      )}
    </MotionTableRow>
  );
}
