"use client";

import * as React from "react";

/**
 * The behaviour behind a drop target: click or keyboard to open the file
 * picker, drag state while a file is over it, and one `onFiles` for both a
 * drop and a pick. Spread `rootProps` on the target and `inputProps` on a
 * hidden file input inside it.
 */
export function useFileDrop({
  onFiles,
  disabled = false,
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const open = React.useCallback(() => {
    if (!disabled) inputRef.current?.click();
  }, [disabled]);

  const accept = React.useCallback(
    (list: FileList | null) => {
      if (disabled || !list || list.length === 0) return;
      onFiles(Array.from(list));
    },
    [disabled, onFiles]
  );

  const rootProps = {
    role: "button" as const,
    tabIndex: 0,
    "data-drag": dragging || undefined,
    "aria-disabled": disabled || undefined,
    onClick: open,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    },
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      accept(e.dataTransfer.files);
    },
  };

  const inputProps = {
    ref: inputRef,
    type: "file" as const,
    className: "hidden",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      accept(e.target.files);
      // Reset so the same file can be picked again.
      e.target.value = "";
    },
  };

  return { dragging, open, rootProps, inputProps };
}
