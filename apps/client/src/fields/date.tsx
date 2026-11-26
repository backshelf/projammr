import { inputDraft, inputEditor } from "@/fields/input";
import { formatScalar, parseTrimmed } from "@/fields/scalar";
import type { FieldKind } from "@/fields/types";
import { useFormat } from "@workspace/ui/components/format-provider";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `year`-`month`-`day` is a day on the calendar, leap years included. */
function isCalendarDate(year: number, month: number, day: number): boolean {
  // `Date.UTC` reads years 0 to 99 as 1900 to 1999, so the year is set apart.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

const parse = parseTrimmed((trimmed) => {
  const match = ISO_DATE.exec(trimmed);
  const valid =
    match !== null &&
    isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
  return valid
    ? { ok: true, value: trimmed }
    : { ok: false, error: "Must be a date (YYYY-MM-DD)" };
});

const describe: NonNullable<FieldKind["describe"]> = (
  value,
  _config,
  formatters
) => (typeof value === "string" && value ? formatters.date(value) : "");

export const date = {
  entry: "editor",
  // A native date input cannot hold a lone digit, so a seeded editor would
  // open empty and the typed character would be lost. Enter and a second
  // click still open it; typing leaves the key to the page.
  seedable: false,
  parse,
  format: formatScalar,
  describe,
  Display: function DateDisplay({ value, config }) {
    return <>{describe(value, config, useFormat())}</>;
  },
  Editor: inputEditor({ parse, format: formatScalar }, { type: "date" }),
  DraftInput: inputDraft({ type: "date" }),
  paste: true,
} satisfies FieldKind;
