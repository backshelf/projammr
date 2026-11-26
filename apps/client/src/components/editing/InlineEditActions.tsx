import { IconCheck, IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";

/**
 * Confirm and cancel for an open inline editor. Confirm is ink and cancel is
 * `--danger`; neither invents a hue, so a row of editors reads as one control
 * pair rather than a traffic light.
 */
export const InlineEditActions = ({
  onConfirm,
  onCancel,
  disabled,
  label,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
  /** Names the field in the two button labels, e.g. "title" or "ISRC". */
  label: string;
}) => (
  <div className={"flex shrink-0 gap-0.5"}>
    <Button
      variant={"ghost"}
      size={"icon-xs"}
      onClick={onConfirm}
      disabled={disabled}
      aria-label={`Save ${label}`}
      className={"text-ink-soft hover:text-ink"}
    >
      <IconCheck size={14} />
    </Button>
    <Button
      variant={"ghost"}
      size={"icon-xs"}
      onClick={onCancel}
      disabled={disabled}
      aria-label={`Cancel editing ${label}`}
      className={"text-danger hover:opacity-80"}
    >
      <IconX size={14} />
    </Button>
  </div>
);
