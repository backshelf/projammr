import type { Brand } from "@/lib/brand-defaults";
import { IMAGE_WIDTHS, type ImageWidth } from "@/lib/utils";
import { serverApiBaseUrl } from "@workspace/api/lib/api-base-url";
import {
  INK_DARK as INK,
  PAPER_DARK as PAPER,
} from "@workspace/ui/lib/brand-colours";
import { LOGO, logoShapeKey } from "@workspace/ui/lib/logo-paths";
import { ImageResponse } from "next/og";
import { createElement } from "react";

/** The Projammr mark drawn `size` px square in `fill`, for Satori's renderer. */
export function logoMark(size: number, fill: string) {
  return (
    <svg viewBox={LOGO.viewBox} width={size} height={size}>
      {LOGO.shapes.map((shape) =>
        createElement(shape.tag, {
          key: logoShapeKey(shape),
          fill,
          ...shape.attrs,
        })
      )}
    </svg>
  );
}

/** The smallest served width that still covers `size` px, so an uploaded
 *  mark is never fetched smaller than it is drawn. */
function widthFor(size: number): ImageWidth {
  return IMAGE_WIDTHS.find((width) => width >= size) ?? IMAGE_WIDTHS.at(-1)!;
}

/** An uploaded mark's bytes as a data URL Satori can draw, sized for the
 *  square it fills; `null` on any fetch failure, for the caller to fall back
 *  to the generated drawing. Asked as PNG: Satori's `ImageResponse` cannot
 *  decode WebP, and JPEG would flatten a logo's transparency. */
export async function brandMarkDataUrl(
  path: string,
  size: number
): Promise<string | null> {
  try {
    const res = await fetch(
      `${serverApiBaseUrl}/static/${path}?w=${widthFor(size)}&format=png`
    );
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:image/png;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Renders the instance's mark centred on a square for the generated icon
 * routes: the brand's icon, else its logo, when set and reachable, on the
 * brand's background colour, so the home-screen icon and the splash it sits
 * on (the manifest's `background_color`) are one surface; with neither, the
 * generated Projammr mark on the dark paper it is drawn for. `scale` is the
 * mark's width as a fraction of the square; maskable icons need a smaller
 * mark because the platform crops to the central 80%.
 */
export async function logoImage(
  side: number,
  scale: number,
  brand?: Pick<Brand, "iconImagePath" | "logoImagePath" | "backgroundColour">
) {
  const size = { width: side, height: side };
  const markSize = side * scale;
  const markPath = brand?.iconImagePath ?? brand?.logoImagePath;
  const dataUrl = markPath ? await brandMarkDataUrl(markPath, markSize) : null;

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: dataUrl && brand ? brand.backgroundColour : PAPER,
      }}
    >
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori renders this, not the browser.
        <img
          src={dataUrl}
          width={markSize}
          height={markSize}
          style={{ objectFit: "contain" }}
        />
      ) : (
        logoMark(markSize, INK)
      )}
    </div>,
    size
  );
}
