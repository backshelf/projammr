"use client";

import { useOpenDeepLink } from "@/components/deep-link/DeepLinkProvider";
import {
  type DitHolder,
  openInDawTarget,
} from "@/components/session/open-in-daw";
import { IconExternalLink } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { IconButton } from "@workspace/ui/components/icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";

export function OpenInDawButton({
  sessionId,
  holder,
  compact = false,
}: {
  sessionId: number;
  holder: DitHolder | null;
  compact?: boolean;
}) {
  const open = useOpenDeepLink();
  const { href, tooltip } = openInDawTarget(sessionId, holder);
  const disabled = href == null;

  const openInDaw = () => {
    if (!disabled) open(href);
  };

  const button = compact ? (
    <IconButton
      aria-disabled={disabled || undefined}
      onClick={openInDaw}
      aria-label="Open in DAW"
    >
      <IconExternalLink />
    </IconButton>
  ) : (
    <Button
      variant="outline"
      aria-disabled={disabled || undefined}
      onClick={openInDaw}
    >
      <IconExternalLink data-icon="inline-start" />
      Open in DAW
    </Button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
