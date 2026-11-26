import type { PeekField, PeekRow } from "../PeekPanel";

/** How many fields a card's meta line holds before it stops being scannable. */
const MAX_CARD_FIELDS = 2;

const hasValue = (field: PeekField) =>
  field.value != null && field.value !== "";

/**
 * The fields a row card shows beside its subtitle, in the order `keyFields`
 * names them rather than the order the peek panel lists them: a card has room
 * for two, and which two matter is an entity's decision, not the panel's.
 * A field that is missing on this row is skipped so the next one takes its
 * place instead of leaving a gap. Two fields sharing an id is a bug in the
 * entity's `toPeekRow`: the first wins and dev builds say so.
 */
export function cardFieldsFrom(
  row: PeekRow,
  keyFields: string[] | undefined
): PeekField[] {
  if (!keyFields?.length || !row.fields?.length) return [];
  const byId = new Map<string, PeekField>();
  for (const field of row.fields) {
    if (!byId.has(field.id)) {
      byId.set(field.id, field);
    } else if (process.env.NODE_ENV !== "production") {
      console.error(`Peek row ${row.id} has two fields with id "${field.id}"`);
    }
  }
  const picked: PeekField[] = [];
  for (const id of keyFields) {
    if (picked.length === MAX_CARD_FIELDS) break;
    const field = byId.get(id);
    if (field && hasValue(field)) picked.push(field);
  }
  return picked;
}
