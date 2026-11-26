import { getContrastColour } from "@/lib/css-utils";
import { Status } from "@workspace/api/api";
import { StatusChip, StatusPill } from "@workspace/ui/components/status-chip";

export type StatusDisplayType = Partial<Status> &
  Pick<Required<Status>, "id" | "colourHex" | "percentage" | "name">;

export type StatusDisplayProps = {
  status: StatusDisplayType;
  variant?: "title" | "icon-title" | "chip";
  className?: string;
};

/**
 * StatusDisplay
 * Not interactible, just displays the given Status in one of four ways.
 *
 * The `title`/`icon-title` variants wear the colour at full strength with
 * contrast-guarded ink, for a masthead or a rail where there is one status to
 * read. The `chip` variant is the quieter tinted treatment (18% fill, 35%
 * border) dense table rows need, so a column of statuses doesn't outshout
 * the artwork.
 */

export const StatusDisplay = (props: StatusDisplayProps) => {
  const { status, variant = "title", className } = props;
  const contrast = getContrastColour(status.colourHex);

  if (variant === "chip") {
    return (
      <StatusChip
        colour={status.colourHex}
        percentage={status.percentage}
        className={className}
      >
        {status.name.toUpperCase()}
      </StatusChip>
    );
  }

  return (
    <StatusPill
      colour={status.colourHex}
      percentage={status.percentage}
      ink={contrast}
      block={variant === "icon-title"}
      className={className}
    >
      {status.name.toUpperCase()}
    </StatusPill>
  );
};
