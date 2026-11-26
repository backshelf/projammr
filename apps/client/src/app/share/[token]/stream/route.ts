import { proxyShareMedia } from "@/lib/share-proxy";
import type { NextRequest } from "next/server";

type Params = { params: Promise<{ token: string }> };

const path = async ({ params }: Params) =>
  `${encodeURIComponent((await params).token)}/stream`;

export async function GET(request: NextRequest, ctx: Params) {
  return proxyShareMedia(request, await path(ctx), "GET", ["id", "download"]);
}

export async function HEAD(request: NextRequest, ctx: Params) {
  return proxyShareMedia(request, await path(ctx), "HEAD", ["id", "download"]);
}
