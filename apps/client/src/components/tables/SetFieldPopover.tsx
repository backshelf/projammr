"use client";

import { fieldKind } from "@/fields";
import { customFieldKey, kindForField } from "@/fields/custom-field";
import type { FieldValue } from "@/fields/types";
import type { CustomField } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import { type FormEvent, useId, useState } from "react";

/**
 * The bulk bar's "Set field…": pick one of the project's custom fields, type a
 * value with the input its kind takes, and apply it to every selected row at
 * once. A value the kind does not read says why under the input and applies
 * nothing; an empty one clears the field on every row.
 */
export function SetFieldPopover({
  fields,
  disabled,
  onApply,
}: {
  fields: readonly CustomField[];
  disabled?: boolean;
  onApply: (key: string, value: FieldValue) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fieldId, setFieldId] = useState<string>(() =>
    String(fields[0]?.id ?? "")
  );
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const field = fields.find((f) => String(f.id) === fieldId);
  const config = field && kindForField(field);
  const kind = config && fieldKind(config.type);
  const Input = kind?.DraftInput;

  const apply = async (event: FormEvent) => {
    event.preventDefault();
    if (!field || !config || !kind) return;
    const parsed = kind.parse(raw, config);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setOpen(false);
    await onApply(customFieldKey(field), parsed.value);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setRaw("");
        setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          Set field…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" side="top" className="w-72 p-3">
        <form aria-label="Set a field" onSubmit={apply} className="grid gap-3">
          <div className="grid gap-1">
            <Label
              id={`${id}-field-label`}
              className="text-micro text-ink-soft"
            >
              Field
            </Label>
            <Select
              value={fieldId}
              items={fields.map((f) => ({
                value: String(f.id),
                label: f.name,
              }))}
              onValueChange={(next) => {
                setFieldId(String(next));
                setRaw("");
                setError(null);
              }}
            >
              <SelectTrigger
                className="h-7 w-full md:text-small"
                aria-labelledby={`${id}-field-label`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fields.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {Input && config && kind && (
            <div className="grid gap-1">
              <Label
                id={`${id}-value-label`}
                htmlFor={`${id}-value`}
                className="text-micro text-ink-soft"
              >
                Value
              </Label>
              {/* A kind's input sizes itself for a table cell; here a text
                  input or a picker takes the popover's width, a box stays one. */}
              <div className={kind.entry === "toggle" ? undefined : "*:w-full"}>
                <Input
                  key={fieldId}
                  id={`${id}-value`}
                  raw={raw}
                  config={config}
                  onChange={(next) => {
                    setRaw(next);
                    setError(null);
                  }}
                  invalid={error !== null}
                  aria-describedby={`${id}-note`}
                  aria-labelledby={`${id}-value-label`}
                />
              </div>
              <p
                id={`${id}-note`}
                role={error ? "alert" : undefined}
                className={cn(
                  "text-micro text-pretty",
                  error ? "text-danger" : "text-ink-soft"
                )}
              >
                {error ??
                  (kind.entry === "toggle"
                    ? "Ticked or not, every row takes this state."
                    : "Leave it empty to clear the field.")}
              </p>
            </div>
          )}
          <Button type="submit" size="sm" className="justify-self-end">
            Apply to selection
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
