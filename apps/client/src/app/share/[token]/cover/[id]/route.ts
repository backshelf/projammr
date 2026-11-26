import { proxyShareMedia } from "@/lib/share-proxy";
import type { NextRequest } from "next/server";

type Params = { params: Promise<{ token: string; id: string }> };

async function path({ params }: Params) {
  const { token, id } = await params;
  return `${encodeURIComponent(token)}/cover/${encodeURIComponent(id)}`;
}

export async function GET(request: NextRequest, ctx: Params) {
  return proxyShareMedia(request, await path(ctx), "GET", ["w"]);
}

export async function HEAD(request: NextRequest, ctx: Params) {
  return proxyShareMedia(request, await path(ctx), "HEAD", ["w"]);
}
