"use client";

import { useFileDrop } from "@workspace/ui/hooks/use-file-drop";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

/**
 * The dashed drop box. Hover and an active drag both tint the border toward
 * the artwork accent and lay a 3% ink wash over the box, so the two states
 * read the same: "this will take a file". Keyboard focus takes the same ring
 * as every other control: the border in the accent with a 2px ring at 30%.
 */
export const dropZoneSurface = cn(
  "cursor-pointer rounded-lg border border-dashed border-rule-strong text-ink-soft",
  "outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
  "motion-ink",
  "hover:border-[color-mix(in_oklab,var(--art)_55%,var(--rule-strong))]",
  "hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]",
  "data-[drag]:border-[color-mix(in_oklab,var(--art)_55%,var(--rule-strong))]",
  "data-[drag]:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]",
  "aria-disabled:cursor-default"
);

/** The tracked-caps action line inside a drop zone ("Drop files here"). */
export const dropZoneLabel =
  "font-sub text-small tracking-[0.1em] uppercase text-ink";

export function DropZone({
  onFiles,
  accept,
  multiple = false,
  disabled = false,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "onDrop" | "onClick"> & {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
}) {
  const { rootProps, inputProps } = useFileDrop({ onFiles, disabled });
  return (
    <div
      data-slot="drop-zone"
      {...rootProps}
      className={cn(dropZoneSurface, className)}
      {...props}
    >
      {children}
      <input {...inputProps} accept={accept} multiple={multiple} />
    </div>
  );
}
