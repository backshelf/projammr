import {
  entrySegment,
  HubPage,
  isHubNotice,
} from "@/components/settings-hub/HubPage";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Personal settings" };

type Props = {
  params: Promise<{ group?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ params, searchParams }: Props) {
  const [{ group }, query] = await Promise.all([params, searchParams]);

  return (
    <HubPage
      section="personal"
      entry={entrySegment(group)}
      notice={isHubNotice(query.notice) ? query.notice : undefined}
      searchParams={query}
    />
  );
}
