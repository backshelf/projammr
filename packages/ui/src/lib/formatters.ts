/**
 * Every date, time, duration, size, loudness, key and tempo a person reads is
 * written here, and nowhere else constructs an `Intl` formatter. A formatter
 * set is built once from the viewer's format preferences and the time zone
 * "auto" resolves to (`formattersFor`); the client hands it down through
 * `FormatProvider`/`useFormat()`, and a server render builds its own per
 * request.
 */

import { formatTimecode } from "@workspace/ui/lib/format";
import { formatLufs } from "@workspace/ui/lib/loudness";
import {
  DIFF_FORMAT_DEFAULTS,
  diffFormat,
  localDecimalPoint,
  type TempoOptions,
  type TempoPrefs,
} from "@workspace/session-diff/format";
import type { KeyNotation } from "@workspace/session-diff/musical-key";

/** What the player's two time readouts show either side of its bar. */
export type PlayerTimeDisplay =
  "elapsed-remaining" | "elapsed-total" | "remaining";

export type FormatPrefs = {
  /** The BCP 47 locale dates and numbers are written in. */
  locale: string;
  clock: "12h" | "24h";
  /** "3 days ago" (long) or "3d" (short). */
  relativeWording: "short" | "long";
  /** The day a week starts on: 0 Sunday, 1 Monday, 6 Saturday. */
  weekStart: 0 | 1 | 6;
  /** An IANA zone, or "auto" for the viewer's own. */
  timeZone: string | "auto";
  tempo: TempoPrefs;
  keyNotation: KeyNotation;
  playerTime: PlayerTimeDisplay;
};

/** The preferences every surface is written in until a viewer picks their own. */
export const DEFAULT_FORMAT_PREFS: FormatPrefs = {
  ...DIFF_FORMAT_DEFAULTS,
  clock: "24h",
  relativeWording: "long",
  weekStart: 0,
  timeZone: "auto",
  playerTime: "elapsed-remaining",
};

/** An instant as the API and the browser hand it over. */
export type DateInput = Date | string | number;

export type Formatters = {
  /** "3 Aug 2026". A bare `YYYY-MM-DD` is a calendar day and reads as that
   *  date in every zone. */
  date: (value: DateInput) => string;
  /** "3 Aug 2026, 14:05", joined as the locale joins a date and a time. */
  dateTime: (value: DateInput) => string;
  /** "March 2019": the month and year, with no day. */
  monthYear: (value: DateInput) => string;
  /** "14:05", or "2:05 pm" on a 12-hour clock. */
  time: (value: DateInput) => string;
  /** "3 days ago" or "3d", counted from `now` (the clock when absent). */
  relative: (value: DateInput, now?: DateInput) => string;
  /** "Today" and "Yesterday" for the two most recent calendar days against
   *  `asOf`, else the dated "Mon 3 Aug". */
  dayLabel: (value: DateInput, asOf: DateInput) => string;
  /** A `YYYY-MM-DD` calendar day, which has no zone, as "Mon 3 Aug". */
  calendarDate: (day: string) => string;
  /** The calendar day `value` falls on in the zone, as the UTC midnight that
   *  starts it: two days subtract to a whole number of days. */
  calendarDay: (value: DateInput) => number;
  /** A total playing time: "27:32", or "1:04:11" past an hour. */
  duration: (ms: number) => string;
  /** Time spent in a set, from seconds: "<1m", "14m", "2h 14m", and whole
   *  hours from ten ("38h"), where the minutes stop being the news. */
  timeInSet: (seconds: number) => string;
  /** A position in a track: 92000 ms is "1:32". */
  timecode: (ms: number) => string;
  /** "1.5 MB", to at most `decimals` places. */
  bytes: (bytes: number, decimals?: number) => string;
  /** Integrated loudness to one decimal with a typographic minus: "−14.0". */
  lufs: (lufs: number) => string;
  /** A count in the locale's grouping: "1,234". */
  number: (value: number) => string;
  /** A tempo, rounded as the preference says: "128", "128 BPM". */
  tempo: (bpm: number | string, options?: TempoOptions) => string;
  /** A key from its tonic and scale, in the preferred notation; null with
   *  neither. */
  key: (
    tonic: string | null | undefined,
    scale: string | null | undefined
  ) => string | null;
  keyNotation: KeyNotation;
  weekStart: FormatPrefs["weekStart"];
  /** The IANA zone every date and time is read in. */
  timeZone: string;
  playerTime: PlayerTimeDisplay;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = (value: DateInput) =>
  value instanceof Date ? value : new Date(value);

/** The zone this runtime reads dates in: the browser's in a browser, the
 *  process's on a server. */
export function runtimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Whether `zone` names an IANA time zone this runtime knows. */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export type ZonedParts = Record<
  "year" | "month" | "day" | "hour" | "minute" | "second",
  number
>;

const CLOCKS = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock reading of `instant` in `timeZone`, month counted from 1. */
export function zonedParts(instant: DateInput, timeZone: string): ZonedParts {
  let clock = CLOCKS.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    CLOCKS.set(timeZone, clock);
  }
  const read: Record<string, number> = {};
  for (const part of clock.formatToParts(toDate(instant))) {
    if (part.type !== "literal") read[part.type] = Number(part.value);
  }
  return read as ZonedParts;
}

const calendarDayIn = (value: DateInput, timeZone: string) => {
  const { year, month, day } = zonedParts(value, timeZone);
  return Date.UTC(year, month - 1, day);
};

/** The `Date#toLocale…` answer to a date that does not parse, kept so a
 *  bad value reads as one rather than throwing mid-render. */
const INVALID = "Invalid Date";

/** A bare `YYYY-MM-DD` (a release date, a heatmap day) names a calendar day,
 *  not an instant: read in a zone, `new Date` of it would be the day before
 *  anywhere west of Greenwich. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

const dateFormatter =
  (format: Intl.DateTimeFormat) =>
  (value: DateInput): string => {
    const date = toDate(value);
    return Number.isNaN(date.getTime()) ? INVALID : format.format(date);
  };

const RELATIVE_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["week", 60 * 60 * 24 * 7],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
];

const BYTE_UNITS = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

/** "3 days ago", "yesterday", "in 2 hours": the locale's own words. */
function longWording(locale: string) {
  const words = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return (amount: number, unit: Intl.RelativeTimeFormatUnit) =>
    words.format(amount, unit);
}

/** "3d", "5m", "2 mth": the unit's narrow symbol, with no "ago" to spell out.
 *  A month takes the short symbol instead: in current CLDR data its narrow
 *  one is the minute's ("1m"). A time still to come keeps its direction in the
 *  locale's narrow words. */
function shortWording(locale: string) {
  const ahead = new Intl.RelativeTimeFormat(locale, { style: "narrow" });
  const symbols = new Map<string, Intl.NumberFormat>();
  return (amount: number, unit: Intl.RelativeTimeFormatUnit) => {
    if (amount > 0) return ahead.format(amount, unit);
    let symbol = symbols.get(unit);
    if (!symbol) {
      symbol = new Intl.NumberFormat(locale, {
        style: "unit",
        unit,
        unitDisplay: unit === "month" ? "short" : "narrow",
      });
      symbols.set(unit, symbol);
    }
    return symbol.format(Math.abs(amount));
  };
}

const WORDINGS = { long: longWording, short: shortWording } as const;

/** Hours and minutes on the preferred clock. A 24-hour clock is pinned to
 *  `h23` so a locale whose own clock is 12-hour still reads 14:05. */
const CLOCK_OPTIONS: Record<FormatPrefs["clock"], Intl.DateTimeFormatOptions> =
  {
    "24h": { hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    "12h": { hour: "numeric", minute: "2-digit", hourCycle: "h12" },
  };

/** A total playing time. Unlike a timecode it can span hours, so the hour
 *  field appears only when there is one and the minutes are then padded. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return hours === 0
    ? `${minutes}:${seconds}`
    : `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
}

/** Time in a set. Minutes are floored, so a span never reads longer than it
 *  was; whole hours stand alone from ten hours up, and an exact hour has no
 *  minutes to show. */
function formatTimeInSet(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours >= 10 || rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * The formatter set for `prefs`, reading dates in `resolvedZone` wherever the
 * preference is "auto" (the viewer's zone as far as the caller knows it) and
 * in the preferred zone otherwise. Pure: the same arguments give the same
 * output, so a server render and the hydration after it agree.
 */
export function formattersFor(
  prefs: FormatPrefs,
  resolvedZone: string
): Formatters {
  const { locale } = prefs;
  const timeZone = prefs.timeZone === "auto" ? resolvedZone : prefs.timeZone;
  const clock = CLOCK_OPTIONS[prefs.clock];

  const dayOptions: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
  };
  const dateOptions: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  };
  const zonedDate = dateFormatter(
    new Intl.DateTimeFormat(locale, { ...dateOptions, timeZone })
  );
  const calendarDateOf = dateFormatter(
    new Intl.DateTimeFormat(locale, { ...dateOptions, timeZone: "UTC" })
  );
  const monthYear = dateFormatter(
    new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone,
    })
  );
  const dateTime = dateFormatter(
    new Intl.DateTimeFormat(locale, { ...dateOptions, ...clock, timeZone })
  );
  const time = dateFormatter(
    new Intl.DateTimeFormat(locale, { ...clock, timeZone })
  );
  const day = dateFormatter(
    new Intl.DateTimeFormat(locale, { ...dayOptions, timeZone })
  );
  const calendarDayOf = dateFormatter(
    new Intl.DateTimeFormat(locale, { ...dayOptions, timeZone: "UTC" })
  );

  const worded = WORDINGS[prefs.relativeWording](locale);
  const dayWords = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const capitalise = (text: string) =>
    text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

  const localPoint = localDecimalPoint(locale);

  const calendarDay = (value: DateInput) => calendarDayIn(value, timeZone);

  const diff = diffFormat({
    locale,
    keyNotation: prefs.keyNotation,
    tempo: prefs.tempo,
  });

  return {
    date: (value) =>
      typeof value === "string" && CALENDAR_DAY.test(value)
        ? calendarDateOf(`${value}T00:00:00Z`)
        : zonedDate(value),
    dateTime,
    monthYear,
    time,
    relative(value, now = Date.now()) {
      const seconds = (toDate(value).getTime() - toDate(now).getTime()) / 1000;
      const [unit, size]: readonly [Intl.RelativeTimeFormatUnit, number] =
        RELATIVE_STEPS.find(([, size]) => Math.abs(seconds) >= size) ?? [
          "second",
          1,
        ];
      return worded(Math.round(seconds / size), unit);
    },
    dayLabel(value, asOf) {
      const days = Math.round(
        (calendarDay(asOf) - calendarDay(value)) / DAY_MS
      );
      return days === 0 || days === 1
        ? capitalise(dayWords.format(-days, "day"))
        : day(value);
    },
    calendarDate: (isoDay) => calendarDayOf(`${isoDay}T00:00:00Z`),
    calendarDay,
    duration: formatDuration,
    timeInSet: formatTimeInSet,
    timecode: formatTimecode,
    bytes(bytes, places = 2) {
      if (bytes === 0) return "0 Bytes";
      const i = Math.floor(Math.log(bytes) / Math.log(1024));
      const figure = parseFloat(
        (bytes / 1024 ** i).toFixed(Math.max(0, places))
      );
      return `${localPoint(String(figure))} ${BYTE_UNITS[i]}`;
    },
    lufs: (lufs) => localPoint(formatLufs(lufs)),
    number: diff.number,
    tempo: diff.tempo,
    key: diff.key,
    keyNotation: prefs.keyNotation,
    weekStart: prefs.weekStart,
    timeZone,
    playerTime: prefs.playerTime,
  };
}

const DEFAULTS_BY_ZONE = new Map<string, Formatters>();

/**
 * The formatter set at {@link DEFAULT_FORMAT_PREFS}, reading dates in
 * `timeZone` (this runtime's own when absent): what a surface with no viewer
 * behind it writes in, such as a page rendered ahead of time.
 */
export function defaultFormatters(timeZone = runtimeZone()): Formatters {
  let format = DEFAULTS_BY_ZONE.get(timeZone);
  if (!format) {
    format = formattersFor(DEFAULT_FORMAT_PREFS, timeZone);
    DEFAULTS_BY_ZONE.set(timeZone, format);
  }
  return format;
}
