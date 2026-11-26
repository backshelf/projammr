"use client";

import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { AppLink } from "@/components/navigation/AppLink";
import { PROJECTS_HREF } from "@/lib/utils";
import { Button } from "@workspace/ui/components/button";

export default function Error({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <CenteredPageShell
      title="Something went wrong loading this page"
      body="Try again, or head back to your projects."
    >
      <div className="flex items-center gap-2">
        <Button onClick={() => retry()}>Try again</Button>
        <Button variant="ghost" asChild>
          <AppLink href={PROJECTS_HREF}>Back to projects</AppLink>
        </Button>
      </div>
    </CenteredPageShell>
  );
}
