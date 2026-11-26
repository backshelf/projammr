import { PriorityBadge } from "@/components/tables/Priority";
import { matchSeed } from "@/fields/scalar";
import type {
  FieldConfig,
  FieldDraftProps,
  FieldEditorProps,
  FieldKind,
  FieldValue,
} from "@/fields/types";
import type { PriorityScaleLevel } from "@workspace/api/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { type RefCallback, useRef } from "react";

/*
 * Priority is a project vocabulary, like status: its options are the levels of
 * the project's scale (`config.priorityLevels`, bottom level first), a value is
 * a level id, and a save writes `priorityId`. A cell shows the level object
 * its row carries, so nothing here is needed to draw one; the scale is only
 * read to parse, to name an id and to offer the levels.
 */

const levelsOf = (config: FieldConfig) => config.priorityLevels ?? [];

const defaultOf = (levels: readonly PriorityScaleLevel[]) =>
  levels.find((level) => level.isDefault);

/** The level whose id `value` is. */
const levelOf = (value: FieldValue, config: FieldConfig) =>
  value === null
    ? undefined
    : levelsOf(config).find((level) => level.id === Number(value));

/**
 * The level `raw` names: the one spelled exactly so, else the first up the
 * scale whose name matches ignoring case (what a pasted cell most often
 * carries), else the one whose id it is. A name wins over an id, so a level
 * called "3" is never mistaken for the level with id 3.
 */
function findLevel(
  levels: readonly PriorityScaleLevel[],
  raw: string
): PriorityScaleLevel | undefined {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  return (
    levels.find((level) => level.name === trimmed) ??
    levels.find((level) => level.name.toLowerCase() === lower) ??
    levels.find((level) => String(level.id) === trimmed)
  );
}

// Blank is the project's default level, the one a new row takes when nothing
// names another. With no scale to read it from, it is left to the server to
// apply: `null`, which a create omits.
const parse: FieldKind["parse"] = (raw, config) => {
  const levels = levelsOf(config);
  if (raw.trim() === "") {
    const fallback = defaultOf(levels);
    if (fallback) return { ok: true, value: fallback.id };
    return config.required
      ? { ok: false, error: "Required" }
      : { ok: true, value: null };
  }
  const level = findLevel(levels, raw);
  return level
    ? { ok: true, value: level.id }
    : { ok: false, error: "Not a priority" };
};

// An id the scale does not have (a level deleted since the page loaded) still
// formats as something, so the cell keeps showing the level its row carries.
const format: FieldKind["format"] = (value, config) =>
  value === null ? "" : (levelOf(value, config)?.name ?? String(value));

/** A picker over a scale's levels, each option worn as its chip. */
export function PriorityMenu({
  levels,
  value,
  onChange,
  onClose,
  onBlur,
  ref,
  defaultOpen,
  className,
  id,
  invalid,
}: {
  levels: readonly PriorityScaleLevel[];
  /** The picked level, or `undefined` for none. */
  value: PriorityScaleLevel | undefined;
  onChange: (level: PriorityScaleLevel) => void;
  onClose?: () => void;
  onBlur?: () => void;
  ref?: RefCallback<HTMLElement>;
  defaultOpen?: boolean;
  className: string;
  id?: string;
  invalid?: boolean;
}) {
  return (
    <Select
      value={value ? String(value.id) : ""}
      items={levels.map((level) => ({
        value: String(level.id),
        label: level.name,
      }))}
      defaultOpen={defaultOpen}
      onValueChange={(next) => {
        const level = levels.find((l) => String(l.id) === next);
        if (level) onChange(level);
      }}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <SelectTrigger
        id={id}
        className={className}
        aria-invalid={invalid || undefined}
        autoFocus={defaultOpen}
        onBlur={onBlur}
        ref={ref}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {levels.map((level) => (
          <SelectItem key={level.id} value={String(level.id)}>
            <PriorityBadge level={level} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The cell editor opens its menu at once. Picking a level commits it; closing
 * the menu any other way cancels.
 */
function PriorityEditor({
  value,
  config,
  seed,
  onCommit,
  onCancel,
}: FieldEditorProps) {
  // Whichever of the pick and the close lands first settles the edit, as the
  // `select` kind's editor does. A one-way "did we pick?" flag would cancel and
  // then commit if the menu reported its close before its value.
  const settledRef = useRef(false);
  const settleOnce = (settle: () => void) => {
    if (settledRef.current) return;
    settledRef.current = true;
    settle();
  };
  const levels = levelsOf(config);
  return (
    <PriorityMenu
      defaultOpen
      levels={levels}
      value={
        matchSeed(seed, levels, (level) => level.name) ??
        levelOf(value, config) ??
        defaultOf(levels)
      }
      className="h-6 md:text-small"
      onChange={(level) => settleOnce(() => onCommit(level.id))}
      onClose={() => settleOnce(onCancel)}
    />
  );
}

/**
 * The draft row's picker. Its raw text is the picked level's name, the same
 * text a paste carries, so a draft parses the way a pasted cell does; blank
 * shows the default level, which is what blank parses to.
 */
function PriorityDraftInput({
  raw,
  config,
  onChange,
  onBlur,
  ref,
  invalid,
  id,
}: FieldDraftProps) {
  const levels = levelsOf(config);
  return (
    <PriorityMenu
      id={id}
      invalid={invalid}
      levels={levels}
      value={raw.trim() === "" ? defaultOf(levels) : findLevel(levels, raw)}
      className="h-7 md:text-small"
      onChange={(level) => onChange(level.name)}
      onBlur={onBlur}
      ref={ref}
    />
  );
}

function PriorityDisplay({
  value,
  config,
}: {
  value: FieldValue;
  config: FieldConfig;
}) {
  const level = levelOf(value, config);
  return level ? (
    <PriorityBadge level={level} />
  ) : (
    <span className="truncate text-body">{format(value, config)}</span>
  );
}

export const priority = {
  entry: "editor",
  parse,
  format,
  Editor: PriorityEditor,
  DraftInput: PriorityDraftInput,
  Display: PriorityDisplay,
  optimisticPatch: (value, config) => {
    // Only a level the scale has patches the row: `priority` is what the cell
    // draws, and a value naming none leaves the row as it is until the server
    // answers (a save of it fails, and the row is rolled back to itself).
    const level = levelOf(value, config);
    return level ? { priorityId: level.id, priority: level } : {};
  },
  saveAs: "priorityId",
  paste: true,
} satisfies FieldKind;
