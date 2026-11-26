"use client";

import { IconPlus, IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Input } from "@workspace/ui/components/input";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "./types";

/**
 * A list of short texts or paths, one field each, with a way to add one and
 * to take each away. An entry the schema refuses (an empty one just added)
 * stays on screen with the row's error until it is filled in.
 */
export function ListControl({
  definition,
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<readonly string[], ControlOf<"list">>) {
  const set = (index: number, entry: string) =>
    onChange(value.map((each, at) => (at === index ? entry : each)));
  const remove = (index: number) =>
    onChange(value.filter((_, at) => at !== index));

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      className="flex w-72 flex-col gap-1.5"
    >
      {value.map((entry, index) => (
        // eslint-disable-next-line @eslint-react/no-array-index-key -- an entry has no identity besides its place in the list
        <span key={index} className="flex items-center gap-1">
          <Input
            value={entry}
            disabled={disabled}
            spellCheck={false}
            aria-label={`${definition.label}, entry ${index + 1}`}
            onChange={(event) => set(index, event.target.value)}
          />
          <IconButton
            type="button"
            disabled={disabled}
            aria-label={`Remove entry ${index + 1}`}
            onClick={() => remove(index)}
          >
            <IconX aria-hidden />
          </IconButton>
        </span>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => onChange([...value, ""])}
        className="self-start"
      >
        <IconPlus aria-hidden data-icon="inline-start" />
        {definition.control.item === "path" ? "Add a path" : "Add an entry"}
      </Button>
    </div>
  );
}
