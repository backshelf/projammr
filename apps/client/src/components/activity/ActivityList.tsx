import { CustomFieldChange } from "@/components/activity/CustomFieldChange";
import { customFieldIdOf, isCustomFieldKey } from "@/fields/custom-field";
import { formatTimecode } from "@workspace/ui/lib/format";
import type { Formatters } from "@workspace/ui/lib/formatters";
import type { Activity, CustomField } from "@workspace/api/api";
import type { ReactNode } from "react";
import { Chronology, ChronologyEntry } from "./Chronology";

const ACTION_VERB: Record<Activity["action"], string> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  commented: "commented on",
  archived: "archived",
  unarchived: "unarchived",
  resolved: "resolved a comment on",
  reopened: "reopened a comment on",
};

type FieldChange = { from: unknown; to: unknown };

/** Fields whose before/after is noise in a feed — timestamps, serialized
 * rich-text blobs, and internal ids. */
const HIDDEN_FIELDS = new Set([
  "updatedAt",
  "createdAt",
  "notes",
  "description",
]);

type Named = { id: number; name: string };

/** The project vocabularies an activity row's id fields are named from. */
export type ActivityVocabularies = {
  statuses?: Named[];
  priorityLevels?: Named[];
  /** The project's custom fields, which name a `cf_<id>` change and type its values. */
  customFields?: CustomField[];
};

/** The fields that hold a vocabulary id, and the vocabulary that names it. */
const NAMED_BY: Record<string, keyof ActivityVocabularies> = {
  statusId: "statuses",
  priorityId: "priorityLevels",
};

/** The names the feed prints for the fields the server records under an id key. */
const FIELD_LABEL: Record<string, string> = {
  statusId: "Status",
  priorityId: "Priority",
};

/**
 * A change's value as the feed prints it. An id the vocabulary still has
 * prints as its name; one it has lost (a deleted level or status) prints as
 * the id, the only thing left to show.
 */
function displayValue(value: unknown, names?: readonly Named[]): string {
  if (value === null || value === undefined || value === "") return "—";
  const named = names?.find((entry) => entry.id === value);
  if (named) return named.name;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  return JSON.stringify(value);
}

function FieldRow({
  field,
  change,
  vocabularies,
}: {
  field: string;
  change: FieldChange;
  vocabularies: ActivityVocabularies;
}) {
  const vocabulary = NAMED_BY[field];
  const names = vocabulary ? vocabularies[vocabulary] : undefined;
  return (
    <span className="mt-[0.1875rem] block text-ink-soft">
      {FIELD_LABEL[field] ?? field}:{" "}
      <span className="text-ink-soft">{displayValue(change.from, names)}</span>{" "}
      → <span className="text-ink">{displayValue(change.to, names)}</span>
    </span>
  );
}

function detail(
  entry: Activity,
  vocabularies: ActivityVocabularies
): ReactNode {
  if (entry.comment) {
    return (
      <span className="mt-[0.1875rem] block border-l border-rule-strong pl-2.5 text-ink-soft">
        {entry.comment.excerpt}
      </span>
    );
  }

  if (entry.action !== "updated" || !entry.changes) return null;

  const entries = Object.entries(entry.changes).filter(
    ([field]) => !HIDDEN_FIELDS.has(field)
  ) as [string, FieldChange][];
  if (entries.length === 0) return null;

  // A single status change is the common case — render it as a bare from → to
  // transition without the field label.
  const status = entries.find(([field]) => field === "statusId");
  if (entries.length === 1 && status) {
    const names = vocabularies.statuses;
    return (
      <span className="mt-[0.1875rem] block text-ink-soft">
        <span className="text-ink-soft">
          {displayValue(status[1].from, names)}
        </span>{" "}
        → <span className="text-ink">{displayValue(status[1].to, names)}</span>
      </span>
    );
  }

  return (
    <>
      {entries.map(([field, change]) =>
        isCustomFieldKey(field) ? (
          <CustomFieldChange
            key={field}
            fieldKey={field}
            field={vocabularies.customFields?.find(
              (f) => f.id === customFieldIdOf(field)
            )}
            from={change.from}
            to={change.to}
          />
        ) : (
          <FieldRow
            key={field}
            field={field}
            change={change}
            vocabularies={vocabularies}
          />
        )
      )}
    </>
  );
}

function headline(entry: Activity): string {
  const who = entry.user?.name ?? "Someone";
  // A deleted entity has no row left to name, so it falls back to its type.
  const what = entry.entityName
    ? `${entry.entityType} ${entry.entityName}`
    : `${entry.entityType} #${entry.entityId}`;
  // A comment pinned to a point in an audio says where: "at 1:52".
  const at =
    entry.comment?.positionMs != null
      ? ` at ${formatTimecode(entry.comment.positionMs)}`
      : "";
  return `${who} ${ACTION_VERB[entry.action]} ${what}${at}`;
}

/**
 * Activity rows, in the order given. Each row keeps the detail of what
 * changed: the name of the entity it describes, field before/after values,
 * status transitions as `from → to`, and an excerpt of the comment a
 * `commented` row quotes. A status or priority change records ids, which
 * print as names from `vocabularies` when it holds them. `format` is the
 * viewer's formatter set, from the server render's `cachedFormatters()`.
 */
export function ActivityList({
  rows,
  format,
  vocabularies = {},
}: {
  rows: Activity[];
  format: Formatters;
  vocabularies?: ActivityVocabularies;
}) {
  return (
    <Chronology>
      {rows.map((entry) => (
        <ChronologyEntry key={entry.id} at={entry.createdAt} format={format}>
          {headline(entry)}
          {detail(entry, vocabularies)}
        </ChronologyEntry>
      ))}
    </Chronology>
  );
}
