import { cn } from "@workspace/ui/lib/utils";
import type { ReactElement } from "react";

const FINGERPRINT_BAR_COUNT = 20;
const MARK_HEIGHT = 10;
const SHA1_HEX = /^[0-9a-f]{40}$/i;

/** Bar widths in units (1–4) for a `<size>:<sha1hex>` fingerprint; [] when null or malformed. */
function barsFromFingerprint(fingerprint: string | null | undefined): number[] {
  if (!fingerprint) return [];
  const colon = fingerprint.indexOf(":");
  if (colon === -1) return [];
  const digest = fingerprint.slice(colon + 1);
  if (!SHA1_HEX.test(digest)) return [];
  return Array.from(
    { length: FINGERPRINT_BAR_COUNT },
    (_, i) => 1 + (Number.parseInt(digest.slice(i * 2, i * 2 + 2), 16) >> 6)
  );
}

/**
 * A file's identity as a grayscale barcode: one bar per fingerprint byte, a unit per pixel at the default
 * height, so two copies of one file draw the same mark. Ink comes from `currentColor`; the host sets it.
 */
function FingerprintMark({
  fingerprint,
  className,
  title,
}: {
  fingerprint: string | null | undefined;
  className?: string;
  /** Accessible name; without it the mark is aria-hidden decoration. */
  title?: string;
}): ReactElement | null {
  const bars = barsFromFingerprint(fingerprint);
  if (bars.length === 0) return null;

  const rects: ReactElement[] = [];
  let x = 0;
  for (const [i, width] of bars.entries()) {
    rects.push(<rect key={i} x={x} width={width} height={MARK_HEIGHT} />);
    x += width + 1;
  }

  return (
    <svg
      data-slot="fingerprint-mark"
      viewBox={`0 0 ${x - 1} ${MARK_HEIGHT}`}
      fill="currentColor"
      className={cn("h-2.5 w-auto shrink-0", className)}
      {...(title ? { role: "img" } : { "aria-hidden": true })}
    >
      {title ? <title>{title}</title> : null}
      {rects}
    </svg>
  );
}

export { FINGERPRINT_BAR_COUNT, barsFromFingerprint, FingerprintMark };
