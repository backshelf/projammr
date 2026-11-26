import { describe, expect, it } from "bun:test";
import {
  DEFAULT_FORMAT_PREFS,
  defaultFormatters,
  type FormatPrefs,
  formattersFor,
  isTimeZone,
  runtimeZone,
  zonedParts,
} from "./formatters";

const prefs = (overrides: Partial<FormatPrefs> = {}): FormatPrefs => ({
  ...DEFAULT_FORMAT_PREFS,
  ...overrides,
});

/** The defaults, read in UTC so the pinned strings do not depend on the
 *  machine running the suite. */
const utc = formattersFor(DEFAULT_FORMAT_PREFS, "UTC");

// August rather than September: ICU spells the short September two ways.
const AT = "2026-08-03T14:05:09Z";

/** A date then a time, whatever ICU joins them with: Apple's data writes
 *  "3 Aug 2026 at 14:05", the data Linux and Chrome ship "3 Aug 2026, 14:05". */
function expectDateTime(text: string, date: string, time: string) {
  expect(text.startsWith(date)).toBe(true);
  expect(text.endsWith(time)).toBe(true);
  expect(text.length).toBeGreaterThan(date.length + time.length);
}

describe("defaults", () => {
  it("write the dates and times the app has always written", () => {
    expect(utc.date(AT)).toBe("3 Aug 2026");
    expect(utc.date(new Date("2026-03-01"))).toBe("1 Mar 2026");
    expectDateTime(utc.dateTime(AT), "3 Aug 2026", "14:05");
    expectDateTime(utc.dateTime("2026-08-03T04:05:00Z"), "3 Aug 2026", "04:05");
    expect(utc.time(AT)).toBe("14:05");
    expect(utc.time("2026-08-03T00:05:00Z")).toBe("00:05");
  });

  it("accept an instant as a Date, an ISO string or epoch milliseconds", () => {
    const ms = Date.parse(AT);
    expect(utc.date(ms)).toBe(utc.date(AT));
    expect(utc.dateTime(new Date(ms))).toBe(utc.dateTime(AT));
  });

  it("write a date that does not parse as the browser does, not throw", () => {
    expect(utc.date("not a date")).toBe("Invalid Date");
    expect(utc.dateTime("")).toBe("Invalid Date");
  });

  it("word a relative date in full, from the now it is given", () => {
    const now = Date.parse(AT);
    const ago = (ms: number) => utc.relative(now + ms, now);
    const DAY = 86_400_000;
    expect(ago(-3 * DAY)).toBe("3 days ago");
    expect(ago(-DAY)).toBe("yesterday");
    expect(ago(-2 * 3_600_000)).toBe("2 hours ago");
    expect(ago(-61_000)).toBe("1 minute ago");
    expect(ago(-5_000)).toBe("5 seconds ago");
    expect(ago(0)).toBe("now");
    expect(ago(2 * DAY)).toBe("in 2 days");
    expect(ago(-8 * DAY)).toBe("last week");
    expect(ago(-40 * DAY)).toBe("last month");
    expect(ago(-400 * DAY)).toBe("last year");
  });

  it("count a relative date from the clock when no now is given", () => {
    expect(utc.relative(Date.now() - 3 * 86_400_000)).toBe("3 days ago");
  });

  it("write a total playing time, with hours only past the hour", () => {
    expect(
      [0, 999, 92_000, 3_599_499, 3_600_000, 3_851_000].map(utc.duration)
    ).toEqual(["0:00", "0:01", "1:32", "59:59", "1:00:00", "1:04:11"]);
    expect(utc.duration(-5_000)).toBe("0:00");
  });

  it("write time in a set in minutes, then hours and minutes, then whole hours from ten", () => {
    expect(
      [0, 59, 60, 840, 3_599, 3_600, 8_040, 35_999, 36_000, 137_000].map(
        utc.timeInSet
      )
    ).toEqual([
      "<1m",
      "<1m",
      "1m",
      "14m",
      "59m",
      "1h",
      "2h 14m",
      "9h 59m",
      "10h",
      "38h",
    ]);
    expect(utc.timeInSet(-5)).toBe("<1m");
  });

  it("write a track position as a timecode", () => {
    expect(utc.timecode(92_000)).toBe("1:32");
    expect(utc.timecode(-1_000)).toBe("0:00");
  });

  it("write a file size in binary units to two places", () => {
    expect(
      [0, 1, 1023, 1024, 1536, 1048576 * 1.256, 5 * 1024 ** 3].map((b) =>
        utc.bytes(b)
      )
    ).toEqual([
      "0 Bytes",
      "1 Bytes",
      "1023 Bytes",
      "1 KB",
      "1.5 KB",
      "1.26 MB",
      "5 GB",
    ]);
    // Rounded as `toFixed` rounds the stored double, not the decimal it prints as.
    expect(utc.bytes(1.005 * 1024)).toBe("1 KB");
    expect(utc.bytes(1536, 0)).toBe("2 KB");
    expect(utc.bytes(1600, 1)).toBe("1.6 KB");
    expect(utc.bytes(1600, -1)).toBe("2 KB");
  });

  it("write loudness to one decimal with a typographic minus", () => {
    expect(utc.lufs(-14)).toBe("−14.0");
    expect(utc.lufs(-8.26)).toBe("−8.3");
    expect(utc.lufs(-0.04)).toBe("0.0");
    expect(utc.lufs(1)).toBe("1.0");
  });

  it("group a count", () => {
    expect(utc.number(1_234_567)).toBe("1,234,567");
    expect(utc.number(12)).toBe("12");
  });

  it("keep a tempo as written, and a whole one where it has no written form", () => {
    expect(utc.tempo("92.35")).toBe("92.35");
    expect(utc.tempo("128")).toBe("128");
    expect(utc.tempo(127.8)).toBe("127.8");
    expect(utc.tempo(127.8, { whole: true })).toBe("128");
    expect(utc.tempo(109.5, { whole: true })).toBe("110");
  });

  it("add BPM where a sentence needs it and nowhere else", () => {
    expect(utc.tempo("128", { unit: true })).toBe("128 BPM");
    expect(utc.tempo(127.8, { unit: true, whole: true })).toBe("128 BPM");
    expect(utc.tempo("128")).toBe("128");
    expect(utc.tempo("128", { unit: false })).toBe("128");
  });

  it("pass a tempo that is not a number through as written", () => {
    expect(utc.tempo("fast")).toBe("fast");
  });

  it("write a key as it was written", () => {
    expect(utc.key("C#", "Major")).toBe("C# Major");
    expect(utc.key("F♯", "minor")).toBe("F♯ minor");
    expect(utc.key("E", null)).toBe("E");
    expect(utc.key(null, null)).toBeNull();
  });

  it("start the week on Sunday, show elapsed and remaining, read auto in the zone given", () => {
    expect(utc.weekStart).toBe(0);
    expect(utc.playerTime).toBe("elapsed-remaining");
    expect(utc.keyNotation).toBe("sharps");
    expect(utc.timeZone).toBe("UTC");
  });
});

describe("dayLabel", () => {
  const asOf = "2026-08-14T15:00:00Z";

  it("reads the same calendar day as Today and the one before as Yesterday", () => {
    expect(utc.dayLabel("2026-08-14T08:30:00Z", asOf)).toBe("Today");
    expect(utc.dayLabel("2026-08-13T22:00:00Z", asOf)).toBe("Yesterday");
  });

  it("dates anything older", () => {
    expect(utc.dayLabel("2026-08-12T12:00:00Z", asOf)).toBe("Wed 12 Aug");
    expect(utc.dayLabel(AT, asOf)).toBe("Mon 3 Aug");
  });

  it("treats late last night and early this morning as different days", () => {
    expect(utc.dayLabel("2026-08-13T23:59:00Z", "2026-08-14T00:01:00Z")).toBe(
      "Yesterday"
    );
  });

  it("counts days in the zone, not in UTC", () => {
    const sydney = formattersFor(DEFAULT_FORMAT_PREFS, "Australia/Sydney");
    // 22:00 UTC on the 13th is already the morning of the 14th in Sydney.
    expect(
      sydney.dayLabel("2026-08-13T22:00:00Z", "2026-08-14T05:00:00Z")
    ).toBe("Today");
    expect(utc.dayLabel("2026-08-13T22:00:00Z", "2026-08-14T05:00:00Z")).toBe(
      "Yesterday"
    );
  });

  it("uses the locale's own words", () => {
    const german = formattersFor(prefs({ locale: "de-DE" }), "UTC");
    expect(german.dayLabel("2026-08-14T08:30:00Z", asOf)).toBe("Heute");
    expect(german.dayLabel("2026-08-13T08:30:00Z", asOf)).toBe("Gestern");
  });
});

describe("date of a calendar day", () => {
  it("reads a bare YYYY-MM-DD as that date wherever the zone is", () => {
    const la = formattersFor(DEFAULT_FORMAT_PREFS, "America/Los_Angeles");
    expect(la.date("2026-08-03")).toBe("3 Aug 2026");
    const auckland = formattersFor(DEFAULT_FORMAT_PREFS, "Pacific/Auckland");
    expect(auckland.date("2026-08-03")).toBe("3 Aug 2026");
  });

  it("reads a full timestamp in the zone", () => {
    const la = formattersFor(DEFAULT_FORMAT_PREFS, "America/Los_Angeles");
    expect(la.date("2026-08-03T00:00:00Z")).toBe("2 Aug 2026");
  });
});

describe("monthYear", () => {
  it("names the month in full and the year, in the zone it is read in", () => {
    expect(utc.monthYear("2019-03-12T09:00:00Z")).toBe("March 2019");
    const tokyo = formattersFor(DEFAULT_FORMAT_PREFS, "Asia/Tokyo");
    expect(tokyo.monthYear("2019-03-31T20:00:00Z")).toBe("April 2019");
  });
});

describe("calendarDate", () => {
  it("reads a calendar day as that date wherever the zone is", () => {
    expect(utc.calendarDate("2026-08-03")).toBe("Mon 3 Aug");
    const la = formattersFor(DEFAULT_FORMAT_PREFS, "America/Los_Angeles");
    expect(la.calendarDate("2026-08-03")).toBe("Mon 3 Aug");
  });
});

describe("calendarDay", () => {
  it("is the UTC midnight of the date in the zone", () => {
    const moment = "2026-06-13T22:30:00Z";
    expect(
      formattersFor(DEFAULT_FORMAT_PREFS, "Etc/GMT-10").calendarDay(moment)
    ).toBe(Date.UTC(2026, 5, 14));
    expect(
      formattersFor(DEFAULT_FORMAT_PREFS, "America/Los_Angeles").calendarDay(
        moment
      )
    ).toBe(Date.UTC(2026, 5, 13));
  });
});

describe("time zone", () => {
  it("reads every date in the zone auto resolved to", () => {
    const la = formattersFor(DEFAULT_FORMAT_PREFS, "America/Los_Angeles");
    expectDateTime(la.dateTime("2026-08-03T04:05:00Z"), "2 Aug 2026", "21:05");
    expect(la.timeZone).toBe("America/Los_Angeles");
  });

  it("reads in the preferred zone over the resolved one", () => {
    const tokyo = formattersFor(prefs({ timeZone: "Asia/Tokyo" }), "UTC");
    expect(tokyo.time(AT)).toBe("23:05");
    expect(tokyo.timeZone).toBe("Asia/Tokyo");
  });
});

describe("clock", () => {
  const twelve = formattersFor(prefs({ clock: "12h" }), "UTC");

  it("writes every time on a 12-hour clock", () => {
    expect(twelve.time(AT)).toBe("2:05 pm");
    expect(twelve.time("2026-08-03T00:05:00Z")).toBe("12:05 am");
    expectDateTime(twelve.dateTime(AT), "3 Aug 2026", "2:05 pm");
  });

  it("keeps a 24-hour clock in a locale whose own clock is 12-hour", () => {
    const us = formattersFor(prefs({ locale: "en-US" }), "UTC");
    expect(us.time(AT)).toBe("14:05");
    expect(us.time("2026-08-03T00:05:00Z")).toBe("00:05");
  });

  it("leaves dates without a time alone", () => {
    expect(twelve.date(AT)).toBe("3 Aug 2026");
  });
});

describe("locale", () => {
  const german = formattersFor(prefs({ locale: "de-DE" }), "UTC");

  it("writes dates in the locale", () => {
    expect(german.date(AT)).toBe("3. Aug. 2026");
    expect(german.time(AT)).toBe("14:05");
  });

  it("writes numbers with the locale's separators", () => {
    expect(german.number(1_234_567)).toBe("1.234.567");
    expect(german.bytes(1536)).toBe("1,5 KB");
    expect(german.lufs(-14)).toBe("−14,0");
    expect(german.tempo("92.35")).toBe("92,35");
  });
});

describe("relative wording", () => {
  const short = formattersFor(prefs({ relativeWording: "short" }), "UTC");
  const now = Date.parse(AT);
  const ago = (ms: number) => short.relative(now + ms, now);

  it("writes a past date as a count and a unit symbol", () => {
    expect(ago(-3 * 86_400_000)).toBe("3d");
    expect(ago(-86_400_000)).toBe("1d");
    expect(ago(-2 * 3_600_000)).toBe("2h");
    expect(ago(-61_000)).toBe("1m");
    expect(ago(-5_000)).toBe("5s");
    expect(ago(-8 * 86_400_000)).toBe("1w");
    expect(ago(-40 * 86_400_000)).toBe("1 mth");
    expect(ago(-400 * 86_400_000)).toBe("1y");
  });

  it("keeps a date still to come in the locale's narrow words", () => {
    expect(ago(2 * 86_400_000)).toBe("in 2 days");
  });

  it("leaves the absolute date in full", () => {
    expectDateTime(short.dateTime(AT), "3 Aug 2026", "14:05");
  });
});

describe("week start", () => {
  it("carries the preferred first day of the week", () => {
    expect(formattersFor(prefs({ weekStart: 1 }), "UTC").weekStart).toBe(1);
    expect(formattersFor(prefs({ weekStart: 6 }), "UTC").weekStart).toBe(6);
  });
});

describe("tempo", () => {
  const tempo = (overrides: Partial<FormatPrefs["tempo"]>) =>
    formattersFor(
      prefs({ tempo: { ...DEFAULT_FORMAT_PREFS.tempo, ...overrides } }),
      "UTC"
    );

  it("rounds to a whole BPM", () => {
    const integer = tempo({ rounding: "integer" });
    expect(integer.tempo("92.35")).toBe("92");
    expect(integer.tempo(127.8, { whole: true })).toBe("128");
  });

  it("rounds to one decimal, statistics included", () => {
    const oneDecimal = tempo({ rounding: "one-decimal" });
    expect(oneDecimal.tempo("92.35")).toBe("92.4");
    expect(oneDecimal.tempo("128")).toBe("128.0");
    expect(oneDecimal.tempo(109.5, { whole: true })).toBe("109.5");
  });

  it("adds BPM under a label when the preference asks for it", () => {
    const suffixed = tempo({ suffix: true });
    expect(suffixed.tempo("128")).toBe("128 BPM");
    expect(suffixed.tempo("128", { unit: true })).toBe("128 BPM");
    expect(suffixed.tempo("128", { unit: false })).toBe("128");
  });
});

describe("key notation", () => {
  it("spells keys in the preferred notation", () => {
    const at = (keyNotation: FormatPrefs["keyNotation"]) =>
      formattersFor(prefs({ keyNotation }), "UTC").key("C#", "Major");
    expect(at("sharps")).toBe("C# Major");
    expect(at("flats")).toBe("D♭ Major");
    expect(at("camelot")).toBe("3B");
    expect(at("openkey")).toBe("8d");
  });
});

describe("player time", () => {
  it("carries the preferred readout", () => {
    expect(
      formattersFor(prefs({ playerTime: "remaining" }), "UTC").playerTime
    ).toBe("remaining");
  });
});

describe("defaultFormatters", () => {
  it("is the default set, reused for the same zone", () => {
    const format = defaultFormatters("UTC");
    expect(format.dateTime(AT)).toBe(utc.dateTime(AT));
    expect(defaultFormatters("UTC")).toBe(format);
  });

  it("reads in this runtime's zone when given none", () => {
    expect(defaultFormatters().timeZone).toBe(runtimeZone());
  });
});

describe("isTimeZone", () => {
  it("knows an IANA zone and refuses anything else", () => {
    expect(isTimeZone("Europe/London")).toBe(true);
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
  });
});

describe("zonedParts", () => {
  it("reads the wall clock in the zone, midnight as hour 0", () => {
    expect(zonedParts("2026-08-03T14:05:09Z", "Asia/Tokyo")).toEqual({
      year: 2026,
      month: 8,
      day: 3,
      hour: 23,
      minute: 5,
      second: 9,
    });
    expect(zonedParts("2026-08-03T00:00:00Z", "UTC").hour).toBe(0);
  });
});
