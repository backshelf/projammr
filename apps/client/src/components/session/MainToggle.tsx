"use client";

import { setSessionMain } from "@/actions/sessions";
import { IconButton } from "@workspace/ui/components/icon-button";
import { RailLabel } from "@workspace/ui/components/layout/rail";
import { IconStar, IconStarFilled } from "@tabler/icons-react";
import { isActionError } from "@workspace/api/lib/action-result";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

interface MainToggleProps {
  sessionId: number;
  isMain: boolean;
  /** Viewers see the star as a static glyph; the server refuses their writes. */
  canEdit: boolean;
}

export default function MainToggle({
  sessionId,
  isMain,
  canEdit,
}: MainToggleProps) {
  const [main, setMain] = useOptimistic(isMain);
  const [, startTransition] = useTransition();

  const toggle = (next: boolean) =>
    startTransition(async () => {
      setMain(next);
      const result = await setSessionMain(sessionId, next);
      if (isActionError(result)) {
        toast.error(`Failed to update: ${result.error}`);
        return;
      }
    });

  return (
    <div>
      <RailLabel
        action={
          canEdit ? (
            <IconButton
              variant="icon"
              size="touch"
              aria-pressed={main}
              aria-label="Main session"
              onClick={() => toggle(!main)}
            >
              {main ? (
                <IconStarFilled className="text-ink" />
              ) : (
                <IconStar className="text-ink-soft" />
              )}
            </IconButton>
          ) : (
            <span aria-hidden className="text-ink-soft">
              {main ? (
                <IconStarFilled className="size-4 text-ink" />
              ) : (
                <IconStar className="size-4" />
              )}
            </span>
          )
        }
      >
        MAIN
      </RailLabel>
      <p className="text-small text-ink-soft">
        The session that carries this track&apos;s work.
      </p>
    </div>
  );
}
