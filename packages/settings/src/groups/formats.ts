import { z } from "zod";
import { defineGroup, defineSetting } from "../define.js";
import { optionsOf } from "../options.js";

export const group = defineGroup({
  id: "formats",
  section: "personal",
  label: "Formats",
  description: "How dates, times, tempos and keys are written.",
  order: 20,
});

const isLocale = (value: string) => {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
};

const isTimeZone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

/** The days a week can start on, as the week-start setting stores them. */
export const WEEK_STARTS = ["sunday", "monday", "saturday"] as const;

export type WeekStart = (typeof WEEK_STARTS)[number];

export const settings = [
  defineSetting({
    key: "formats.locale",
    group: "formats",
    label: "Language and region",
    description:
      "The locale dates and numbers are written in, such as en-GB or de-DE.",
    keywords: ["locale", "region", "country", "date format", "numbers"],
    scopes: ["user", "instance"],
    schema: z
      .string()
      .max(35)
      .refine(isLocale, "Not a locale this browser knows, such as en-GB."),
    default: "en-GB",
    control: { kind: "text", placeholder: "en-GB" },
    audience: "public",
  }),
  defineSetting({
    key: "formats.clock",
    group: "formats",
    label: "Clock",
    description: "Times on a 24-hour or a 12-hour clock.",
    keywords: ["time", "am", "pm", "24 hour", "12 hour"],
    scopes: ["user", "instance"],
    schema: z.enum(["24h", "12h"]),
    default: "24h",
    control: {
      kind: "select",
      options: optionsOf({ "24h": "24-hour", "12h": "12-hour" }),
    },
    audience: "public",
  }),
  defineSetting({
    key: "formats.relativeWording",
    group: "formats",
    label: "Relative times",
    description: "“3 days ago” written out, or shortened to “3d”.",
    keywords: ["ago", "relative", "time"],
    scopes: ["user", "instance"],
    schema: z.enum(["long", "short"]),
    default: "long",
    control: {
      kind: "select",
      options: optionsOf({ long: "3 days ago", short: "3d" }),
    },
    audience: "public",
  }),
  defineSetting({
    key: "formats.weekStart",
    group: "formats",
    label: "Week starts on",
    description: "The first day of a week in calendars and the activity grid.",
    keywords: ["calendar", "monday", "sunday", "heatmap"],
    scopes: ["user", "project", "instance"],
    schema: z.enum(WEEK_STARTS),
    default: "sunday",
    control: {
      kind: "select",
      options: optionsOf({
        sunday: "Sunday",
        monday: "Monday",
        saturday: "Saturday",
      }),
    },
    audience: "public",
  }),
  defineSetting({
    key: "formats.timeZone",
    group: "formats",
    label: "Time zone",
    description:
      "An IANA zone such as Europe/London, or auto for this browser's own.",
    keywords: ["zone", "timezone", "utc", "clock"],
    scopes: ["user", "project", "instance"],
    schema: z
      .string()
      .min(1)
      .refine(
        (value) => value === "auto" || isTimeZone(value),
        "Not a time zone; write one such as Europe/London, or auto."
      ),
    default: "auto",
    control: { kind: "text", placeholder: "auto" },
    audience: "public",
  }),
  defineSetting({
    key: "formats.playerTime",
    group: "formats",
    label: "Player time",
    description: "What the player's two readouts show either side of its bar.",
    keywords: ["elapsed", "remaining", "duration", "player"],
    scopes: ["user", "instance"],
    schema: z.enum(["elapsed-remaining", "elapsed-total", "remaining"]),
    default: "elapsed-remaining",
    control: {
      kind: "select",
      options: optionsOf({
        "elapsed-remaining": "Elapsed and remaining",
        "elapsed-total": "Elapsed and total",
        remaining: "Remaining",
      }),
    },
    audience: "public",
  }),
  defineSetting({
    key: "formats.tempoRounding",
    group: "formats",
    label: "Tempo",
    description: "A tempo as it was written, or rounded.",
    keywords: ["bpm", "tempo", "decimal", "round"],
    scopes: ["user", "project", "instance"],
    schema: z.enum(["raw", "integer", "one-decimal"]),
    default: "raw",
    control: {
      kind: "select",
      options: optionsOf({
        raw: "As written",
        integer: "Whole numbers",
        "one-decimal": "One decimal",
      }),
    },
    audience: "public",
  }),
  defineSetting({
    key: "formats.tempoSuffix",
    group: "formats",
    label: "BPM after tempos",
    description:
      "Write “BPM” after a tempo even where its label already names the unit.",
    keywords: ["bpm", "tempo", "unit"],
    scopes: ["user", "project", "instance"],
    schema: z.boolean(),
    default: false,
    control: { kind: "toggle" },
    audience: "public",
  }),
  defineSetting({
    key: "formats.keyNotation",
    group: "formats",
    label: "Key notation",
    description: "How musical keys are spelled.",
    keywords: ["key", "camelot", "open key", "sharps", "flats"],
    scopes: ["user", "project", "instance"],
    schema: z.enum(["sharps", "flats", "camelot", "openkey"]),
    default: "sharps",
    control: {
      kind: "select",
      options: optionsOf({
        sharps: "Sharps (C♯m)",
        flats: "Flats (D♭m)",
        camelot: "Camelot (12A)",
        openkey: "Open Key (5m)",
      }),
    },
    audience: "public",
  }),
];
