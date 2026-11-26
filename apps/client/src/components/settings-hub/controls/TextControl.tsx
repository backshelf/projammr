"use client";

import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import {
  describedByOf,
  type ControlOf,
  type SettingControlProps,
} from "./types";

/** A line of text, or several when the setting says `multiline`. Every keystroke is a change; the row saves once typing pauses. */
export function TextControl({
  definition,
  value,
  onChange,
  disabled,
  id,
  invalid,
}: SettingControlProps<string, ControlOf<"text">>) {
  const { multiline, placeholder } = definition.control;
  const field = {
    id,
    value,
    disabled,
    placeholder,
    spellCheck: false,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedByOf(id),
  };

  return multiline ? (
    <Textarea
      {...field}
      onChange={(event) => onChange(event.target.value)}
      className="w-72"
    />
  ) : (
    <Input
      {...field}
      onChange={(event) => onChange(event.target.value)}
      className="w-48"
    />
  );
}
