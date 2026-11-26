"use client";

import { number } from "@/fields/number";
import type { SettingDefinition } from "@workspace/settings";
import { Input } from "@workspace/ui/components/input";
import { useState } from "react";
import { describedByOf } from "./types";

/**
 * What an empty field means for a numeric setting: its declared placeholder
 * when its schema takes `null` (a cap that is not set, history kept forever),
 * or undefined when it must hold a number.
 */
export const emptyMeaning = (
  definition: SettingDefinition & { readonly control: { placeholder?: string } }
): string | undefined =>
  definition.schema.safeParse(null).success
    ? (definition.control.placeholder ?? "")
    : undefined;

/**
 * A number typed as text, the unit after it. What the reader types is kept
 * as typed while they are in the field, and only a number is handed on:
 * half-typed text ("", "-", "1.") marks the field invalid rather than
 * reaching the setting, and leaving the field shows the value again. The
 * number and duration controls share it.
 *
 * Given `empty`, what an empty field means ("No cap"), the value may be
 * `null`: it shows as an empty field with `empty` as its placeholder, and
 * clearing the field hands on `null`.
 */
export function NumericInput({
  id,
  value,
  onChange,
  disabled,
  unit,
  empty,
  invalid,
}: {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled: boolean;
  unit?: string;
  empty?: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const read = (raw: string) =>
    empty !== undefined && raw.trim() === ""
      ? ({ ok: true, value: null } as const)
      : number.parse(raw, { required: true });
  const parsed = text === null ? null : read(text);

  return (
    <span className="inline-flex items-center gap-2">
      <Input
        id={id}
        inputMode="decimal"
        value={text ?? (value === null ? "" : String(value))}
        placeholder={empty}
        disabled={disabled}
        aria-invalid={parsed?.ok === false || invalid || undefined}
        aria-describedby={describedByOf(id)}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const next = read(raw);
          if (
            next.ok &&
            (next.value === null || typeof next.value === "number")
          ) {
            onChange(next.value);
          }
        }}
        onBlur={() => setText(null)}
        className="w-24 text-right tabular-nums"
      />
      {unit && <span className="text-small text-ink-soft">{unit}</span>}
    </span>
  );
}
