import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { SignInPrompt } from "@/components/auth/SignInPrompt";
import { ShareComments } from "@/components/share/ShareComments";
import { ShareFooter } from "@/components/share/ShareFooter";
import { ShareMasthead } from "@/components/share/ShareMasthead";
import { ShareRoomProvider } from "@/components/share/ShareRoom";
import { ShareTrackList } from "@/components/share/ShareTrackList";
import { getCachedSession, sessionUser } from "@/lib/session";
import { SHARE_UNAVAILABLE, shareErrorKind } from "@/lib/share-links";
import { requestOrigin } from "@/lib/request-origin";
import { loadSharelink } from "@/lib/share-read";
import {
  SHARE_UNAVAILABLE_METADATA,
  shareMetadata,
} from "@/lib/share-metadata";
import { isActionError } from "@workspace/api/lib/action-result";
import { COLUMN } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { Metadata } from "next";
import { headers } from "next/headers";

type Props = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const sharelink = await loadSharelink(token);
  if (isActionError(sharelink)) return SHARE_UNAVAILABLE_METADATA;
  return shareMetadata(sharelink, requestOrigin(await headers()));
}

export default async function SharePage({ params }: Props) {
  const { token } = await params;
  const [session, sharelink] = await Promise.all([
    getCachedSession(),
    loadSharelink(token),
  ]);

  if (isActionError(sharelink)) {
    // An instance that keeps its share links to accounts answers a signed-out
    // reader, or a guest, 401: the ordinary sign-in card is the way in.
    if (sharelink.status === 401) return <SignInPrompt />;
    const kind = shareErrorKind(sharelink);
    if (kind === null) throw new Error(sharelink.error);
    return <CenteredPageShell {...SHARE_UNAVAILABLE[kind]} />;
  }

  return (
    <ShareRoomProvider
      token={token}
      sharelink={sharelink}
      viewerId={sessionUser(session)?.id ?? null}
    >
      <ShareMasthead />
      <div className={cn(COLUMN, "flex flex-col gap-10 px-(--gutter) py-10")}>
        <ShareTrackList />
        <ShareComments />
        <ShareFooter />
      </div>
    </ShareRoomProvider>
  );
}
