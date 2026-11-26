import { getInvitePreview } from "@/actions/members";
import InviteFlow from "@/components/auth/InviteFlow";
import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { SignInPrompt } from "@/components/auth/SignInPrompt";
import { cachedInstance } from "@/lib/server-data";
import { getCachedSession, sessionUser } from "@/lib/session";
import { isActionError } from "@workspace/api/lib/action-result";
import type { Metadata } from "next";
import { cache } from "react";

type Props = {
  params: Promise<{ token: string }>;
};

/** The metadata and the page both need the preview; this is one request's
 *  worth of it rather than two. */
const loadInvitePreview = cache(getInvitePreview);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const preview = await loadInvitePreview(token);
  return {
    title: isActionError(preview)
      ? "Project invite"
      : `Invite to ${preview.projectName}`,
  };
}

const ROLE_LABEL: Record<string, string> = {
  owner: "an owner",
  admin: "an admin",
  editor: "an editor",
  viewer: "a viewer",
};

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const [session, preview, instance] = await Promise.all([
    getCachedSession(),
    loadInvitePreview(token),
    cachedInstance(),
  ]);
  const signedIn = sessionUser(session) !== null;

  if (isActionError(preview)) {
    // An instance that keeps invite links to accounts answers a signed-out
    // caller 401: the ordinary sign-in card is the way in.
    if (preview.status === 401) return <SignInPrompt />;
    return (
      <CenteredPageShell
        title="This invite link isn't valid"
        body="It may have been revoked, or the link is incomplete. Ask whoever invited you to send a new one."
      />
    );
  }

  if (preview.accepted) {
    return (
      <CenteredPageShell
        title="This invite has already been used"
        body={`The invite to ${preview.projectName} was already accepted. If that wasn't you, ask for a new one.`}
      />
    );
  }

  if (preview.expired) {
    return (
      <CenteredPageShell
        title="This invite has expired"
        body={`The invite to ${preview.projectName} is no longer valid. Ask ${preview.invitedByName ?? "whoever invited you"} to send a fresh one.`}
      />
    );
  }

  const inviter = preview.invitedByName ?? "Someone";
  const role = ROLE_LABEL[preview.role] ?? `a ${preview.role}`;

  return (
    <CenteredPageShell
      title={`Join ${preview.projectName}`}
      body={`${inviter} invited you to ${preview.projectName} as ${role}.${signedIn ? " Accept to join." : ""}`}
    >
      <InviteFlow
        token={token}
        email={preview.email}
        signedIn={signedIn}
        passwordRule={isActionError(instance) ? undefined : instance}
      />
    </CenteredPageShell>
  );
}
