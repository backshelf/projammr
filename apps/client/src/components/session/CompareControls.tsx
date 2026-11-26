"use client";

import { Button } from "@workspace/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useParamWriter } from "@/hooks/use-param-writer";
import { useId } from "react";

/** A save, reduced to what a picker needs — never its parsed `meta`. */
export type CompareOption = { id: number; label: string };

/**
 * The history page's only client component: the "From"/"To" pickers for the
 * compare canvas, plus a Clear. Reselecting "To" drops `from` from the URL
 * rather than trying to keep it valid — the page falls back to "the save
 * before it" itself, so there is exactly one place that rule lives.
 */
export function CompareControls({
  options,
  fromId,
  toId,
}: {
  /** Newest first. */
  options: CompareOption[];
  fromId?: number;
  toId?: number;
}) {
  const fromLabelId = useId();
  const toLabelId = useId();
  const { write } = useParamWriter();

  const setTo = (value: string) => write({ to: value, from: null });
  const setFrom = (value: string) => write({ from: value });
  const clear = () => write({ from: null, to: null });

  // "From" only offers saves older than the one selected as "To".
  const toIndex = options.findIndex((option) => option.id === toId);
  const fromOptions = toIndex === -1 ? options : options.slice(toIndex + 1);

  return (
    <div className="flex flex-wrap items-center gap-3 phone:flex-col phone:items-stretch">
      <div className="flex max-w-full min-w-0 items-center gap-1.5">
        <span id={fromLabelId} className="text-micro text-ink-soft">
          From
        </span>
        <Select
          value={fromId != null ? String(fromId) : undefined}
          onValueChange={setFrom}
          items={fromOptions.map((option) => ({
            value: String(option.id),
            label: option.label,
          }))}
        >
          <SelectTrigger
            size="sm"
            aria-labelledby={fromLabelId}
            className="max-w-full min-w-40 phone:min-w-0 phone:flex-1"
          >
            <SelectValue placeholder="Earlier save" />
          </SelectTrigger>
          <SelectContent>
            {fromOptions.map((option) => (
              <SelectItem key={option.id} value={String(option.id)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex max-w-full min-w-0 items-center gap-1.5">
        <span id={toLabelId} className="text-micro text-ink-soft">
          To
        </span>
        <Select
          value={toId != null ? String(toId) : undefined}
          onValueChange={setTo}
          items={options.map((option) => ({
            value: String(option.id),
            label: option.label,
          }))}
        >
          <SelectTrigger
            size="sm"
            aria-labelledby={toLabelId}
            className="max-w-full min-w-40 phone:min-w-0 phone:flex-1"
          >
            <SelectValue placeholder="Later save" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={String(option.id)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={clear}>
        Clear
      </Button>
    </div>
  );
}
