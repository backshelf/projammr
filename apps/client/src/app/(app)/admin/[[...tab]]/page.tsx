import { settingsHref } from "@/lib/settings/href";
import { notFound, redirect } from "next/navigation";

/** The admin tabs whose place in the Instance section has another id. */
const INSTANCE_ENTRIES = new Map([["registration", "instance-access"]]);

type Props = { params: Promise<{ tab?: string[] }> };

/**
 * `/admin[/<tab>]` names the instance's settings, which live in the settings
 * hub: `/admin` the Instance section, a tab its pane or group there. The hub
 * answers a caller who is not an instance admin with its 404.
 */
export default async function Page({ params }: Props) {
  const [tab, ...deeper] = (await params).tab ?? [];
  if (deeper.length > 0) notFound();

  redirect(
    settingsHref({
      section: "instance",
      group: tab === undefined ? undefined : (INSTANCE_ENTRIES.get(tab) ?? tab),
    })
  );
}
