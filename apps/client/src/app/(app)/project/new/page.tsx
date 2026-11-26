import { TopStrip } from "@/components/dock/TopStrip";
import NewProject from "@/modules/project/new";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "New project",
};

export default async function NewProjectPage() {
  return (
    <div className={"flex h-full min-h-0 flex-col"}>
      <Suspense fallback={<div className={"min-h-11 md:hidden"} aria-hidden />}>
        <TopStrip back />
      </Suspense>
      <div className={"min-h-0 flex-1"}>
        <NewProject />
      </div>
    </div>
  );
}
