"use client";

import { IconCheck, IconCopy } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { useCopied } from "@/hooks/use-copied";

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

export default function CopyButton({
  value,
  label,
  className,
}: CopyButtonProps) {
  const { copied, copy } = useCopied();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={label ?? "Copy to clipboard"}
      className={className}
      onClick={(e) => {
        e.stopPropagation();
        copy(value);
      }}
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </Button>
  );
}
