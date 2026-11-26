"use client";

import { CenteredPageShell } from "@/components/auth/CenteredPageShell";
import { useBrand } from "@/lib/brand-context";
import { Button } from "@workspace/ui/components/button";

export default function ShareError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const brand = useBrand();
  return (
    <CenteredPageShell
      title={`Can't reach ${brand.name}`}
      body="The server didn't answer. Try again in a moment."
    >
      <Button onClick={() => retry()}>Try again</Button>
    </CenteredPageShell>
  );
}
