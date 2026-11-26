import type { PriorityScaleLevel, Status } from "@workspace/api/api";
import type { Formatters } from "@workspace/ui/lib/formatters";
import type { ComponentType, RefCallback } from "react";

export type FieldKindName =
  | "text"
  | "number"
  | "date"
  | "select"
  | "status"
  | "checkbox"
  | "priority"
  | "list"
  | "suggest"
  | "url";

/** What a cell holds once parsed: the value a save writes. */
export type FieldValue = string | number | boolean | string[] | null;

/** A raw string is either a valid value for its kind or an error to show. */
export type ParseResult =
  { ok: true; value: FieldValue } | { ok: false; error: string };

/**
 * One choice of a `select`: the value a save writes (a custom field's option
 * id), the label it reads as, and a colour it may wear.
 */
export type SelectOption = { value: string; label: string; colour?: string };

export type FieldConfig = {
  /** The field's name, for a control drawn with no visible label of its own. */
  label?: string;
  placeholder?: string;
  /** An empty value is an error rather than `null`. */
  required?: boolean;
  options?: SelectOption[];
  suggestions?: string[];
  statuses?: Status[];
  /** The project's priority scale, bottom level first. */
  priorityLevels?: PriorityScaleLevel[];
};

export type FieldEditorProps = {
  value: FieldValue;
  config: FieldConfig;
  /** Starts the draft from this text instead of the value's own. */
  seed?: string;
  onCommit: (value: FieldValue) => void;
  onCancel: () => void;
};

export type FieldDraftProps = {
  raw: string;
  config: FieldConfig;
  onChange: (raw: string) => void;
  invalid: boolean;
  id: string;
  /** The labelled field row's hint and error, for a kind whose control can carry it. */
  "aria-describedby"?: string;
  /**
   * The labelled field row's own label, for a kind whose control isn't
   * `htmlFor`-labelable (e.g. `status`'s dropdown trigger).
   */
  "aria-labelledby"?: string;
  /**
   * RHF's blur handler, so `mode: "onTouched"` sees the field touched and
   * shows a parse error without waiting for submit. A table's draft row and
   * `use-cell-grid.tsx` render the same `DraftInput`s outside a form and
   * need not pass it.
   */
  onBlur?: () => void;
  /**
   * RHF's ref, so a failed submit's `shouldFocusError` can focus the first
   * invalid field-kind row. Must land on an element with `.focus()`.
   */
  ref?: RefCallback<HTMLElement>;
};

export type FieldKind = {
  /**
   * How a cell of this kind is entered. `editor`: the grid mounts `Editor`.
   * `self`: the cell owns its own popup. `toggle`: a commit flips the value.
   */
  entry: "editor" | "self" | "toggle";
  /**
   * False: typing a character on a focused cell of this kind does nothing, and
   * the key is left to the page's own hotkeys. For a kind whose `Editor` can
   * neither show the character nor act on it — a native `date` input rejects a
   * lone digit, so seeding one opens an empty editor and swallows the key.
   * Defaults to true; only meaningful alongside `entry: "editor"`.
   */
  seedable?: boolean;
  parse: (raw: string, config: FieldConfig) => ParseResult;
  format: (value: FieldValue, config: FieldConfig) => string;
  /**
   * The value as a person reads it, in the viewer's formats: a date as
   * "3 Aug 2026", a figure grouped. Absent, `format` is already that.
   */
  describe?: (
    value: FieldValue,
    config: FieldConfig,
    formatters: Formatters
  ) => string;
  Editor?: ComponentType<FieldEditorProps>;
  DraftInput: ComponentType<FieldDraftProps>;
  Display?: ComponentType<{ value: FieldValue; config: FieldConfig }>;
  optimisticPatch?: (
    value: FieldValue,
    config: FieldConfig
  ) => Record<string, unknown>;
  /** The row field a save writes, when it is not the column id. */
  saveAs?: string;
  /** False: a pasted rectangle passes over this column. */
  paste: boolean;
};
