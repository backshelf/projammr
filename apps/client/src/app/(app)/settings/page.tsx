import { SETTINGS_HREF } from "@/lib/settings/href";
import { redirect } from "next/navigation";

/** The hub opens on the caller's own settings. */
export default function Page() {
  redirect(SETTINGS_HREF);
}
