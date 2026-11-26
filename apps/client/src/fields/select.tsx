import { matchSeed, parseTrimmed } from "@/fields/scalar";
import type {
  FieldConfig,
  FieldDraftProps,
  FieldEditorProps,
  FieldKind,
  FieldValue,
  SelectOption,
} from "@/fields/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { StatusChip } from "@workspace/ui/components/status-chip";
import { useRef } from "react";

/*
 * A value is an option's `value` (a custom field's option id), read as its
 * `label`. A value no option has any more (one removed since the row was
 * saved) still formats, as itself, so the cell keeps showing what the row
 * holds until someone edits it.
 */

const optionsOf = (config: FieldConfig) => config.options ?? [];

/** The option whose value `value` is. */
const optionOf = (value: FieldValue, config: FieldConfig) =>
  value === null
    ? undefined
    : optionsOf(config).find((option) => option.value === String(value));

/**
 * The option `raw` names: the one labelled exactly so, else the first whose
 * label matches ignoring case (what a pasted cell most often carries), else
 * the one whose value it is. A label wins over a value, as a priority level's
 * name wins over its id.
 */
function findOption(
  options: readonly SelectOption[],
  raw: string
): SelectOption | undefined {
  const lower = raw.toLowerCase();
  return (
    options.find((option) => option.label === raw) ??
    options.find((option) => option.label.toLowerCase() === lower) ??
    options.find((option) => option.value === raw)
  );
}

const parse = parseTrimmed((trimmed, config) => {
  const option = findOption(optionsOf(config), trimmed);
  return option === undefined
    ? { ok: false, error: "Not one of the options" }
    : { ok: true, value: option.value };
});

const format: FieldKind["format"] = (value, config) =>
  value === null ? "" : (optionOf(value, config)?.label ?? String(value));

const PLACEHOLDER = "Select...";

/** An option as a menu item and a cell draw it: its colour's chip, or its label. */
function OptionLabel({ option }: { option: SelectOption }) {
  return option.colour ? (
    <StatusChip flag colour={option.colour}>
      {option.label}
    </StatusChip>
  ) : (
    <span className="truncate">{option.label}</span>
  );
}

function OptionPopup({ options }: { options: readonly SelectOption[] }) {
  return (
    <SelectContent align="start">
      {options.map((option) => (
        <SelectItem key={option.value} value={option.value}>
          <OptionLabel option={option} />
        </SelectItem>
      ))}
    </SelectContent>
  );
}

const itemsOf = (config: FieldConfig) =>
  optionsOf(config).map(({ value, label }) => ({ value, label }));

/**
 * The cell editor of a `select`: the popup opens on mount, a pick commits, and
 * every other way out of it (Escape, a click elsewhere, focus moving on)
 * cancels. Whichever happens first settles the edit; the close that follows a
 * pick is not a cancel.
 */
function SelectEditor({
  value,
  config,
  seed,
  onCommit,
  onCancel,
}: FieldEditorProps) {
  const settledRef = useRef(false);
  const settleOnce = (settle: () => void) => {
    if (settledRef.current) return;
    settledRef.current = true;
    settle();
  };
  const options = optionsOf(config);

  return (
    // The popup is portaled but still inside this element as far as React is
    // concerned: its keys stay here rather than reaching the grid's navigation
    // handler. Escape never gets this far; the popup closes on it, and that
    // close is the cancel.
    <div
      className="flex w-full flex-col"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <Select
        defaultOpen
        value={
          (
            matchSeed(seed, options, (option) => option.label) ??
            optionOf(value, config)
          )?.value ?? ""
        }
        items={itemsOf(config)}
        onValueChange={(picked) => settleOnce(() => onCommit(picked as string))}
        onOpenChange={(open) => {
          if (!open) settleOnce(onCancel);
        }}
      >
        <SelectTrigger className="h-6 md:text-small">
          <SelectValue placeholder={config.placeholder ?? PLACEHOLDER} />
        </SelectTrigger>
        <OptionPopup options={options} />
      </Select>
    </div>
  );
}

/**
 * The draft row's and a form's picker. Its raw text is the picked option's
 * label, the same text a paste carries, so a draft parses the way a pasted
 * cell does.
 */
function SelectDraft({
  raw,
  config,
  onChange,
  onBlur,
  ref,
  invalid,
  id,
  "aria-labelledby": labelledBy,
}: FieldDraftProps) {
  const options = optionsOf(config);
  const picked =
    raw.trim() === "" ? undefined : findOption(options, raw.trim());
  return (
    <Select
      value={picked?.value ?? ""}
      items={itemsOf(config)}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onChange(option.label);
      }}
    >
      <SelectTrigger
        id={id}
        className="h-7 md:text-small"
        aria-invalid={invalid || undefined}
        aria-labelledby={labelledBy}
        onBlur={onBlur}
        ref={ref}
      >
        <SelectValue placeholder={config.placeholder ?? PLACEHOLDER} />
      </SelectTrigger>
      <OptionPopup options={options} />
    </Select>
  );
}

/**
 * A value as a cell shows it: its option's chip or label, or, for a value no
 * option has any more, the raw value in faint ink.
 */
function SelectDisplay({
  value,
  config,
}: {
  value: FieldValue;
  config: FieldConfig;
}) {
  const option = optionOf(value, config);
  if (option) return <OptionLabel option={option} />;
  return (
    <span
      className="truncate font-mono text-small text-ink-faint"
      title="Not one of the options any more"
    >
      {format(value, config)}
    </span>
  );
}

export const select = {
  entry: "editor",
  parse,
  format,
  Editor: SelectEditor,
  DraftInput: SelectDraft,
  Display: SelectDisplay,
  paste: true,
} satisfies FieldKind;
