import { useMemo, type JSX } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@workspace/ui/components/combobox";
import { cn } from "@workspace/ui/lib/utils";

/** One thing a picker offers: what it hands back and what the person reads and types against. */
export type PickerOption = { value: string; label: string };

const SAME_VALUE = (a: PickerOption, b: PickerOption): boolean =>
  a.value === b.value;

/**
 * A choice among a few named things, with type-to-filter: `@workspace/ui`'s combobox as a single-select field. The
 * input shows the chosen option's label; opening it lists every option, and typing narrows the list. `label` names
 * the field for a screen reader, since the pickers sit in a table-like row whose column heading does not travel
 * with the control; a field that has a visible label of its own names itself by that element's id instead
 * (`labelledBy`). A value that is not among `options` shows as an empty field.
 */
export function Picker({
  label,
  labelledBy,
  options,
  value,
  onChange,
  disabled = false,
  className,
}: {
  label: string;
  labelledBy?: string;
  options: readonly PickerOption[];
  value: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}): JSX.Element {
  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  );

  return (
    <Combobox
      items={options}
      value={selected}
      isItemEqualToValue={SAME_VALUE}
      onValueChange={(next) => {
        if (next) onChange(next.value);
      }}
      disabled={disabled}
    >
      <ComboboxInput
        aria-label={labelledBy === undefined ? label : undefined}
        aria-labelledby={labelledBy}
        disabled={disabled}
        className={cn("w-full min-w-0 text-small", className)}
      />
      <ComboboxContent>
        <ComboboxEmpty>No match</ComboboxEmpty>
        <ComboboxList>
          {(option: PickerOption) => (
            <ComboboxItem key={option.value} value={option}>
              {option.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
