import { HubPage } from "@/components/settings-hub/HubPage";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Device settings" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <HubPage section="devices" searchParams={await searchParams} />;
}
