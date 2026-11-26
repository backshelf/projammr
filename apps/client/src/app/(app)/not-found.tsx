import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { AppLink } from "@/components/navigation/AppLink";
import { PROJECTS_HREF } from "@/lib/utils";
import { Button } from "@workspace/ui/components/button";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
  return (
    <CenteredPageShell
      title="Not found"
      body="This page doesn't exist, or you don't have access to it."
    >
      <Button asChild>
        <AppLink href={PROJECTS_HREF}>Back to projects</AppLink>
      </Button>
    </CenteredPageShell>
  );
}
