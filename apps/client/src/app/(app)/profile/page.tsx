import ProfilePage from "@/components/auth/ProfilePage";
import { TopStrip } from "@/components/dock/TopStrip";
import { getInstance } from "@/actions/instance";
import { getMyHeatmap } from "@/actions/me";
import { cachedFormatters } from "@/lib/formatters";
import { hasSaves, yearHeatmapQuery } from "@/lib/heatmap-range";
import { cachedMe } from "@/lib/server-data";
import { getCachedSession, sessionUser } from "@/lib/session";
import { isActionError } from "@workspace/api/lib/action-result";
import { WIDEST_PASSWORD_RULE } from "@workspace/ui/lib/password-rule";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Profile",
};

export default async function Page() {
  const user = sessionUser(await getCachedSession());

  if (!user) {
    redirect("/");
  }

  const [me, heatmap, instance] = await Promise.all([
    cachedMe(),
    cachedFormatters().then(({ timeZone }) =>
      getMyHeatmap(yearHeatmapQuery(timeZone))
    ),
    getInstance(),
  ]);
  if (isActionError(me)) {
    redirect("/");
  }

  // An instance this page could not read is assumed to have mail: the mailed
  // paths fail loudly and recoverably, where the no-mail paths would ask for a
  // password against a server that may not be answering either. It is also
  // held to the widest password rule, and keeps the deletion section, whose
  // attempt the server refuses on its own if the instance turned it off.
  const read = isActionError(instance) ? null : instance;

  return (
    <div className={"flex h-full min-h-0 flex-col"}>
      <Suspense fallback={<div className={"min-h-11 md:hidden"} aria-hidden />}>
        <TopStrip back />
      </Suspense>
      <div className={"min-h-0 flex-1"}>
        <ProfilePage
          user={user}
          hasSaves={!isActionError(heatmap) && hasSaves(heatmap)}
          emailEnabled={read?.emailEnabled ?? true}
          passwordRule={read ?? WIDEST_PASSWORD_RULE}
          selfDeletion={read?.selfDeletion ?? true}
        />
      </div>
    </div>
  );
}
