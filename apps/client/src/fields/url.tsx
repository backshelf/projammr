import { inputDraft, inputEditor } from "@/fields/input";
import { formatScalar, parseTrimmed } from "@/fields/scalar";
import type { FieldKind, FieldValue } from "@/fields/types";

/**
 * Whether `raw` is a full web link, http or https, as the server insists: a
 * link without a scheme and host has nowhere to go from a table cell, and any
 * other scheme (`javascript:`, `data:`) is not one to put in an `href`.
 */
function isWebLink(raw: string): boolean {
  return URL.canParse(raw) && /^https?:$/.test(new URL(raw).protocol);
}

const parse = parseTrimmed((trimmed) =>
  isWebLink(trimmed)
    ? { ok: true, value: trimmed }
    : { ok: false, error: "Must be a full link (https://…)" }
);

/** The link as it reads: its host and path, the scheme dropped. */
function linkText(href: string): string {
  return href.replace(/^[a-z][a-z\d+.-]*:\/\//i, "").replace(/\/$/, "");
}

/**
 * A link value, opened in a new tab so the table or page it sits on stays
 * where it was. The full address is its tooltip. A value that is not a web
 * link reads as plain text, never as an `href`.
 */
export function UrlDisplay({ value }: { value: FieldValue }) {
  if (typeof value !== "string" || value === "") return null;
  if (!isWebLink(value)) {
    return <span className="block min-w-0 truncate">{value}</span>;
  }
  return (
    <a
      href={value}
      target="_blank"
      rel="noopener noreferrer"
      title={value}
      className="block min-w-0 truncate text-ink underline decoration-rule-strong underline-offset-4 motion-ink hover:decoration-ink"
    >
      {linkText(value)}
    </a>
  );
}

export const url = {
  entry: "editor",
  parse,
  format: formatScalar,
  Editor: inputEditor({ parse, format: formatScalar }, { type: "url" }),
  DraftInput: inputDraft({ type: "url" }),
  Display: UrlDisplay,
  paste: true,
} satisfies FieldKind;
