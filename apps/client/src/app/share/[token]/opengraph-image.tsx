import { brandMarkDataUrl, logoMark } from "@/app/logo-image";
import { cachedBrand } from "@/lib/brand";
import { getForwardedFor } from "@/lib/request-cookie";
import { shareFacts, shareTitle } from "@/lib/share-links";
import { posterCover } from "@/lib/share-metadata";
import { loadSharelink } from "@/lib/share-read";
import { isActionError } from "@workspace/api/lib/action-result";
import { serverApiBaseUrl } from "@workspace/api/lib/api-base-url";
import {
  INK_DARK as INK,
  PAPER_DARK as PAPER,
} from "@workspace/ui/lib/brand-colours";
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Rendered per request, never prerendered. `generateImageMetadata` makes Next
 * give the route a `generateStaticParams`, which classes it as ISR: the first
 * request for a token would be rendered with no request to read the share
 * with, answer 404, and that 404 would be cached for the token. A share is
 * also revocable, so the server keeps no poster, and the response is
 * `private`, as the cover it is drawn from is: no shared cache may go on
 * serving a link's title and artwork after it is turned off.
 */
export const dynamic = "force-dynamic";

const SIZE = { width: 1200, height: 630 };

/** Satori reads TTF and WOFF only, so the poster's faces are the TTFs beside
 *  the woff2 files the layout loads. */
const font = (file: string) =>
  readFile(join(process.cwd(), "public/fonts", file));
const fonts = Promise.all([
  font("Redaction35.ttf"),
  font("DepartureMono-Regular.ttf"),
  font("SplineSansMono.ttf"),
]);

/** The ink at the strength the page's quiet text uses, as rgba for Satori. */
const INK_MUTED = "rgba(252, 252, 252, 0.72)";

/** `ArtField`'s card scrim as rgba over `PAPER_DARK`: the floor the type sits on. */
const SCRIM =
  "linear-gradient(to bottom, rgba(8, 8, 8, 0.4) 0%, rgba(8, 8, 8, 0.58) 34%, rgba(8, 8, 8, 0.74) 62%, rgba(8, 8, 8, 0.82) 100%)";

const COVER_FIELD = 1400;
const COVER_SQUARE = SIZE.height - 2 * 64;

type Props = {
  params: Promise<{ token: string }>;
};

/** One image, whose alt is the title; a share that cannot be read has none, so
 *  the page of a dead link carries no poster. The read can also throw: Next
 *  calls this from `generateStaticParams` with no request to read the cookies
 *  from, and the page's own render must not fall over for want of a poster. */
export async function generateImageMetadata({ params }: Props) {
  const { token } = await params;
  const sharelink = await loadSharelink(token).catch(() => null);
  if (!sharelink || isActionError(sharelink)) return [];
  return [
    {
      id: "poster",
      alt: shareTitle(sharelink),
      size: SIZE,
      contentType: "image/png",
    },
  ];
}

/** The cover as a data URL Satori can draw, or null when the API has none to
 *  give. The API keys its share limits on the caller's address, so the
 *  request's own is forwarded. */
async function fetchCover(token: string, trackAudioId: number) {
  const forwardedFor = await getForwardedFor();
  try {
    const res = await fetch(
      `${serverApiBaseUrl}/api/share/${encodeURIComponent(token)}/cover/${trackAudioId}?w=1024&format=jpeg`,
      { headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {} }
    );
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function Image({ params }: Props) {
  const { token } = await params;
  const sharelink = await loadSharelink(token);
  if (isActionError(sharelink)) return new Response(null, { status: 404 });

  const posterSource = posterCover(sharelink);
  const [brand, mark, cover, [redaction, departure, spline]] =
    await Promise.all([
      cachedBrand(),
      cachedBrand().then((brand) =>
        brand.logoImagePath ? brandMarkDataUrl(brand.logoImagePath, 40) : null
      ),
      posterSource ? fetchCover(token, posterSource.trackAudioId) : null,
      fonts,
    ]);

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        overflow: "hidden",
        background: PAPER,
        color: INK,
      }}
    >
      {cover ? (
        <>
          <img
            src={cover}
            alt=""
            width={COVER_FIELD}
            height={COVER_FIELD}
            style={{
              position: "absolute",
              left: (SIZE.width - COVER_FIELD) / 2,
              top: (SIZE.height - COVER_FIELD) / 2,
              objectFit: "cover",
              filter: "blur(80px)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: SCRIM,
            }}
          />
        </>
      ) : null}
      <div
        style={{
          display: "flex",
          flex: 1,
          padding: 64,
          gap: 64,
        }}
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            width={COVER_SQUARE}
            height={COVER_SQUARE}
            style={{ objectFit: "cover", flexShrink: 0 }}
          />
        ) : null}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            flex: 1,
            minWidth: 0,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div
              style={{
                display: "block",
                fontFamily: "Redaction 35",
                fontSize: 88,
                lineHeight: 1,
                lineClamp: 2,
                wordBreak: "break-word",
              }}
            >
              {shareTitle(sharelink)}
            </div>
            <div
              style={{
                fontFamily: "Departure Mono",
                fontSize: 22,
                letterSpacing: 22 * 0.12,
                textTransform: "uppercase",
                color: INK_MUTED,
              }}
            >
              {shareFacts(sharelink)}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              fontFamily: "Spline Sans Mono",
              fontSize: 28,
            }}
          >
            {mark ? (
              <img
                src={mark}
                width={40}
                height={40}
                style={{ objectFit: "contain" }}
              />
            ) : (
              logoMark(40, INK)
            )}
            {brand.name}
          </div>
        </div>
      </div>
    </div>,
    {
      ...SIZE,
      fonts: [
        { name: "Redaction 35", data: redaction, weight: 400, style: "normal" },
        {
          name: "Departure Mono",
          data: departure,
          weight: 400,
          style: "normal",
        },
        {
          name: "Spline Sans Mono",
          data: spline,
          weight: 400,
          style: "normal",
        },
      ],
      headers: { "Cache-Control": "private, max-age=3600" },
    }
  );
}
