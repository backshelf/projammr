"use client";

import { IconPlus, IconX } from "@tabler/icons-react";
import { z } from "zod";
import { Button } from "@workspace/ui/components/button";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Input } from "@workspace/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useState } from "react";
import {
  describedByOf,
  labelIdOf,
  type ControlOf,
  type SettingControlProps,
} from "../types";

type Aliases = Record<string, string>;

/**
 * The add row's own message, apart from the row's `errorIdOf` element, which
 * `SettingRow` renders for a refused write.
 */
const entryErrorIdOf = (id: string) => `${id}-entry-error`;

/** A command id as words: `new-track-titled` reads "new track titled". */
function commandLabel(id: string): string {
  return id.replaceAll("-", " ");
}

/**
 * The value a command may take: the enum's members when the setting's
 * `valueType` is an enum, so the add row offers a select; any non-empty
 * string otherwise, so it offers a text field.
 */
function valueOptionsOf(schema: unknown): readonly string[] | undefined {
  if (!(schema instanceof z.ZodRecord)) return undefined;
  const { valueType } = schema;
  return valueType instanceof z.ZodEnum
    ? (Object.values(valueType.enum) as string[])
    : undefined;
}

/** Whether `alias` and `command` both pass the setting's own schema. */
function entryError(
  schema: unknown,
  aliases: Aliases,
  alias: string,
  command: string
): string | undefined {
  if (alias.trim() === "") return "Give the alias a word.";
  if (Object.hasOwn(aliases, alias)) return "That alias is already taken.";
  if (!(schema instanceof z.ZodRecord)) return undefined;
  const keyType = schema.keyType as z.ZodType;
  const valueType = schema.valueType as z.ZodType;
  if (!keyType.safeParse(alias).success) {
    return "That word doesn't fit: keep it short, with no spaces.";
  }
  if (!valueType.safeParse(command).success) {
    return "That isn't a command this palette knows.";
  }
  return undefined;
}

/**
 * Your own words for the palette's commands: one row per alias, each with
 * the command it opens and a way to take it away, plus a row to add one.
 * Validates through the setting's own schema (`keyType`/`valueType` of its
 * `z.record`) rather than a hard-coded list of commands, so it works for
 * whatever the schema currently accepts.
 */
export function PaletteAliasesControl({
  definition,
  value,
  onChange,
  disabled,
  id,
}: SettingControlProps<unknown, ControlOf<"custom">>) {
  const aliases = (value ?? {}) as Aliases;
  const commandOptions = valueOptionsOf(definition.schema);
  const [alias, setAlias] = useState("");
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  const remove = (removed: string) =>
    onChange(
      Object.fromEntries(
        Object.entries(aliases).filter(([each]) => each !== removed)
      )
    );

  const add = () => {
    const problem = entryError(definition.schema, aliases, alias, command);
    if (problem) {
      setError(problem);
      return;
    }
    onChange({ ...aliases, [alias]: command });
    setAlias("");
    setCommand("");
    setError(undefined);
  };

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      className="flex w-80 flex-col gap-1.5"
    >
      {Object.entries(aliases).map(([each, target]) => (
        <span key={each} className="flex items-center gap-1.5">
          <span className="flex-1 text-small">
            {each} → {target}
          </span>
          <IconButton
            disabled={disabled}
            aria-label={`Remove ${each}`}
            onClick={() => remove(each)}
          >
            <IconX aria-hidden />
          </IconButton>
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <Input
          value={alias}
          disabled={disabled}
          spellCheck={false}
          placeholder="Alias"
          aria-label="New alias"
          aria-describedby={error ? entryErrorIdOf(id) : undefined}
          onChange={(event) => setAlias(event.target.value)}
        />
        {commandOptions ? (
          <Select
            value={command}
            onValueChange={setCommand}
            disabled={disabled}
            items={commandOptions.map((each) => ({
              value: each,
              label: commandLabel(each),
            }))}
          >
            <SelectTrigger aria-label="New command">
              <SelectValue placeholder="Command" />
            </SelectTrigger>
            <SelectContent>
              {commandOptions.map((each) => (
                <SelectItem key={each} value={each}>
                  {commandLabel(each)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Input
            value={command}
            disabled={disabled}
            spellCheck={false}
            placeholder="Command"
            aria-label="New command"
            onChange={(event) => setCommand(event.target.value)}
          />
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={add}
        >
          <IconPlus aria-hidden data-icon="inline-start" />
          Add
        </Button>
      </span>
      {error ? (
        <span
          id={entryErrorIdOf(id)}
          role="alert"
          className="text-small text-pretty text-danger"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
