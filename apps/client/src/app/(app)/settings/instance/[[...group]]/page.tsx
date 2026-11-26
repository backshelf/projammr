import { entrySegment, HubPage } from "@/components/settings-hub/HubPage";
import { cachedIsInstanceAdmin } from "@/lib/server-data";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Instance settings" };

type Props = {
  params: Promise<{ group?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The instance's settings, for its admins alone: anyone else gets the 404 `/admin` gives them. */
export default async function Page({ params, searchParams }: Props) {
  if (!(await cachedIsInstanceAdmin())) notFound();
  const [{ group }, query] = await Promise.all([params, searchParams]);

  return (
    <HubPage
      section="instance"
      entry={entrySegment(group)}
      searchParams={query}
    />
  );
}
