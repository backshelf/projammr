export type ReleasePhrase = { label: string; tone: "future" | "soon" | "past" };

/** Local midnight for `date`, so day differences count whole calendar days
 *  rather than 24-hour spans (which drift across a DST boundary). */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A bare "YYYY-MM-DD" release date names a calendar day, not an instant —
 *  parsing it with `new Date(string)` reads it as UTC midnight, which lands
 *  on the wrong local day west of Greenwich. Parse those components as a
 *  local date instead; anything else (a full timestamp) parses as-is. */
function toLocalDate(value: string): Date {
  const match = DATE_ONLY.exec(value);
  if (!match) return new Date(value);
  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/** Days up to 13 ("3 days"), then weeks up to 8 ("6 weeks"), then months
 *  ("3 months"). `days` is a positive whole number of calendar days. */
function spanLabel(days: number): string {
  if (days < 14) {
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  const weeks = Math.round(days / 7);
  if (weeks < 9) {
    return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "month" : "months"}`;
}

/** "Releases in 12 days", "Releases tomorrow", "Released 3 weeks ago"; `soon`
 *  inside 14 days. */
export function releasePhrase(
  releaseDate: string,
  now = new Date()
): ReleasePhrase {
  const days = Math.round(
    (startOfDay(toLocalDate(releaseDate)).getTime() -
      startOfDay(now).getTime()) /
      86_400_000
  );
  if (days === 0) return { label: "Releases today", tone: "soon" };
  if (days === 1) return { label: "Releases tomorrow", tone: "soon" };
  if (days > 1) {
    return {
      label: `Releases in ${spanLabel(days)}`,
      tone: days <= 14 ? "soon" : "future",
    };
  }
  return { label: `Released ${spanLabel(-days)} ago`, tone: "past" };
}
