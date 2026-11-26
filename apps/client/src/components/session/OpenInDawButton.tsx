"use client";

import { DeepLinkFallbackDialog } from "@/components/deep-link/DeepLinkFallbackDialog";
import { useDeepLink } from "@/components/deep-link/use-deep-link";
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
  TooltipProvider,
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
  const { open, fallbackOpen, setFallbackOpen } = useDeepLink();
  const { href, tooltip } = openInDawTarget(sessionId, holder);
  const disabled = href == null;

  const openInDaw = () => {
    if (href != null) open(href);
  };

  const button = compact ? (
    <IconButton
      disabled={disabled}
      onClick={openInDaw}
      aria-label="Open in DAW"
    >
      <IconExternalLink />
    </IconButton>
  ) : (
    <Button variant="outline" disabled={disabled} onClick={openInDaw}>
      <IconExternalLink data-icon="inline-start" />
      Open in DAW
    </Button>
  );

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {disabled ? <span className="inline-flex">{button}</span> : button}
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DeepLinkFallbackDialog
        open={fallbackOpen}
        onOpenChange={setFallbackOpen}
      />
    </>
  );
}
