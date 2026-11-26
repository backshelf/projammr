import { describe, expect, it } from "bun:test";
import type { ShareOption, Sharelink } from "@workspace/api/api";
import {
  defaultAudio,
  expiryLabel,
  fromDateInputValue,
  hasExpired,
  NEVER_EXPIRES,
  neverExpires,
  SHARE_UNAVAILABLE,
  shareActionError,
  shareErrorKind,
  shareFacts,
  sharePath,
  toDateInputValue,
} from "./share-links";
import { defaultFormatters } from "@workspace/ui/lib/formatters";

const format = defaultFormatters("UTC");

describe("share link expiry", () => {
  it("reads the far-future sentinel as no expiry at all", () => {
    expect(neverExpires(NEVER_EXPIRES)).toBe(true);
    expect(hasExpired(NEVER_EXPIRES)).toBe(false);
    expect(expiryLabel(NEVER_EXPIRES, format)).toBe("Never expires");
  });

  it("treats a rounded sentinel as the sentinel", () => {
    expect(neverExpires("9999-12-31T00:00:00.000Z")).toBe(true);
    expect(neverExpires("9998-01-01T00:00:00.000Z")).toBe(true);
  });

  it("separates a link that has lapsed from one still live", () => {
    const now = Date.UTC(2026, 8, 12);
    expect(hasExpired("2026-09-01T00:00:00.000Z", now)).toBe(true);
    expect(hasExpired("2026-10-01T00:00:00.000Z", now)).toBe(false);
    // The short September is ICU data, spelt "Sept" or "Sep" by platform.
    expect(expiryLabel("2026-09-01T00:00:00.000Z", format, now)).toMatch(
      /^Expired 1 Sept? 2026$/
    );
    expect(expiryLabel("2026-10-01T00:00:00.000Z", format, now)).toBe(
      "Expires 1 Oct 2026"
    );
  });

  it("round-trips a picked day through the date input", () => {
    const picked = "2026-11-03";
    const stored = fromDateInputValue(picked);
    expect(toDateInputValue(stored)).toBe(picked);
  });

  it("keeps a link alive through the whole day it was set to expire on", () => {
    const stored = fromDateInputValue("2026-11-03");
    const middayOnTheDay = new Date(2026, 10, 3, 12).getTime();
    expect(hasExpired(stored, middayOnTheDay)).toBe(false);
    expect(hasExpired(stored, new Date(2026, 10, 4, 0, 1).getTime())).toBe(
      true
    );
  });
});

describe("sharePath", () => {
  it("builds the guest route from the token alone", () => {
    expect(sharePath("abc123")).toBe("/share/abc123");
  });
});

describe("defaultAudio", () => {
  const track = (
    audios: { id: number; version: number; isPrimary: boolean }[]
  ) =>
    ({
      id: 1,
      title: "T",
      position: null,
      audios: audios.map((audio) => ({ ...audio, fileName: null })),
    }) as ShareOption;

  it("picks the primary even when a later version exists", () => {
    const chosen = defaultAudio(
      track([
        { id: 20, version: 2, isPrimary: false },
        { id: 10, version: 1, isPrimary: true },
      ])
    );
    expect(chosen?.id).toBe(10);
  });

  it("falls back to the newest when nothing is primary", () => {
    const chosen = defaultAudio(
      track([
        { id: 20, version: 2, isPrimary: false },
        { id: 10, version: 1, isPrimary: false },
      ])
    );
    expect(chosen?.id).toBe(20);
  });
});

describe("shareErrorKind", () => {
  it("reads a 404 as invalid", () => {
    expect(shareErrorKind({ error: "x", status: 404 })).toBe("invalid");
  });

  it("reads a plain 410 as expired", () => {
    expect(shareErrorKind({ error: "x", status: 410 })).toBe("expired");
  });

  it("reads a 410 coded expired as expired", () => {
    expect(shareErrorKind({ error: "x", status: 410, code: "expired" })).toBe(
      "expired"
    );
  });

  it("reads a 410 coded revoked as revoked", () => {
    expect(shareErrorKind({ error: "x", status: 410, code: "revoked" })).toBe(
      "revoked"
    );
  });

  it("leaves a 429 and a 5xx to the error boundary", () => {
    expect(shareErrorKind({ error: "x", status: 500 })).toBeNull();
    expect(shareErrorKind({ error: "x", status: 429 })).toBeNull();
  });

  it("has copy for every kind", () => {
    expect(SHARE_UNAVAILABLE.revoked.title).toBe(
      "This share link was turned off"
    );
    expect(SHARE_UNAVAILABLE.expired.title).toBe("This share link has expired");
    expect(SHARE_UNAVAILABLE.invalid.title).toBe("This share link isn't valid");
  });
});

describe("shareActionError", () => {
  it("tells a guest a revoked link was turned off, not that it expired", () => {
    expect(
      shareActionError({ error: "Gone", status: 410, code: "revoked" })
    ).toEqual({
      error: "This share link was turned off",
      status: 410,
      code: "revoked",
    });
  });

  it("names an expired link and an unknown one", () => {
    expect(shareActionError({ error: "Gone", status: 410 }).error).toBe(
      "This share link has expired"
    );
    expect(shareActionError({ error: "Not found", status: 404 }).error).toBe(
      "This share link isn't valid"
    );
  });

  it("leaves a failure that says nothing about the link alone", () => {
    const error = { error: "Too many requests", status: 429 };
    expect(shareActionError(error)).toBe(error);
  });
});

describe("shareFacts", () => {
  const audio = (durationMs?: number | null, version?: number) => ({
    id: 1,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(version !== undefined ? { version } : {}),
  });
  const share = (
    entityType: Sharelink["entityType"],
    tracks: Array<Sharelink["tracks"][number]["trackAudio"]>
  ) =>
    ({
      entityType,
      tracks: tracks.map((trackAudio, i) => ({
        id: i,
        trackAudio,
        artwork: null,
      })),
    }) as Sharelink;

  it("counts a collection's tracks and sums their minutes", () => {
    const four = share("collection", [
      audio(240_000),
      audio(240_000),
      audio(240_000),
      audio(120_000),
    ]);
    expect(shareFacts(four)).toBe("Shared collection · 4 tracks · 14 min");
  });

  it("says '1 track' for a collection of one", () => {
    expect(shareFacts(share("collection", [audio(90_000)]))).toBe(
      "Shared collection · 1 track · 1 min"
    );
  });

  it("skips tracks without audio when counting", () => {
    expect(shareFacts(share("collection", [audio(90_000), {}]))).toBe(
      "Shared collection · 1 track · 1 min"
    );
  });

  it("shows hours past an hour", () => {
    expect(shareFacts(share("collection", [audio(3_840_000)]))).toBe(
      "Shared collection · 1 track · 1 h 4 min"
    );
  });

  it("shows under a minute as <1 min", () => {
    expect(shareFacts(share("collection", [audio(30_000)]))).toBe(
      "Shared collection · 1 track · <1 min"
    );
  });

  it("gives a track its timecode and version", () => {
    expect(shareFacts(share("track", [audio(222_000, 3)]))).toBe(
      "Shared track · 3:42 · version 3"
    );
  });

  it("omits the segments a track has no value for", () => {
    expect(shareFacts(share("track", [audio(null)]))).toBe("Shared track");
  });
});
