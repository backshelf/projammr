import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import {
  barsFromFingerprint,
  FINGERPRINT_BAR_COUNT,
  FingerprintMark,
} from "./fingerprint-mark";

afterEach(cleanup);

const FINGERPRINT = "1048576:da39a3ee5e6b4b0d3255bfef95601890afd80709";
const BOUNDARIES = `2048:003f407f80bfc0ff${"00".repeat(12)}`;

describe("barsFromFingerprint", () => {
  it("gives one width in 1..4 per byte of a valid fingerprint", () => {
    const bars = barsFromFingerprint(FINGERPRINT);

    expect(bars).toHaveLength(FINGERPRINT_BAR_COUNT);
    for (const width of bars) {
      expect(width).toBeGreaterThanOrEqual(1);
      expect(width).toBeLessThanOrEqual(4);
    }
    expect(barsFromFingerprint(FINGERPRINT)).toEqual(bars);
  });

  it("maps each quarter of the byte range to one width", () => {
    expect(barsFromFingerprint(BOUNDARIES).slice(0, 8)).toEqual([
      1, 1, 2, 2, 3, 3, 4, 4,
    ]);
  });

  it("returns no bars for a missing or malformed fingerprint", () => {
    const digest = FINGERPRINT.split(":")[1]!;

    expect(barsFromFingerprint(null)).toEqual([]);
    expect(barsFromFingerprint(undefined)).toEqual([]);
    expect(barsFromFingerprint("")).toEqual([]);
    expect(barsFromFingerprint(digest)).toEqual([]);
    expect(barsFromFingerprint(`1048576:${digest.slice(1)}`)).toEqual([]);
    expect(barsFromFingerprint(`1048576:${digest}0`)).toEqual([]);
    expect(barsFromFingerprint(`1048576:${digest.slice(1)}g`)).toEqual([]);
  });

  it("reads upper-case hex the same as lower-case", () => {
    expect(barsFromFingerprint(FINGERPRINT.toUpperCase())).toEqual(
      barsFromFingerprint(FINGERPRINT)
    );
  });
});

describe("FingerprintMark", () => {
  it("draws a bar per byte in a viewBox as wide as the bars and their gaps", () => {
    const { container } = render(<FingerprintMark fingerprint={FINGERPRINT} />);
    const svg = container.querySelector("svg")!;
    const widths = barsFromFingerprint(FINGERPRINT);
    const total = widths.reduce((sum, width) => sum + width, 0);

    expect(svg.querySelectorAll("rect")).toHaveLength(FINGERPRINT_BAR_COUNT);
    expect(svg.getAttribute("viewBox")).toBe(
      `0 0 ${total + FINGERPRINT_BAR_COUNT - 1} 10`
    );
  });

  it("renders nothing for a null fingerprint", () => {
    const { container } = render(<FingerprintMark fingerprint={null} />);

    expect(container.innerHTML).toBe("");
  });

  it("is an image named by its title", () => {
    const { container } = render(
      <FingerprintMark fingerprint={FINGERPRINT} title="File fingerprint" />
    );
    const svg = container.querySelector("svg")!;

    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
    expect(svg.querySelector("title")!.textContent).toBe("File fingerprint");
  });

  it("is hidden decoration without a title", () => {
    const { container } = render(<FingerprintMark fingerprint={FINGERPRINT} />);
    const svg = container.querySelector("svg")!;

    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.querySelector("title")).toBeNull();
  });
});
