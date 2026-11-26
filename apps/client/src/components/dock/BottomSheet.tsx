"use client";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

/** A row in a bottom sheet: a full-width 48px touch target. */
export const SHEET_ROW =
  "flex min-h-12 w-full items-center gap-3 px-4 text-left text-body text-ink";

/**
 * The row that backs out of a sheet without choosing anything. Set beneath a
 * destructive row rather than beside it — the iOS action-sheet pattern — since
 * the destructive row already confirms through its own dialog.
 */
export function SheetCancelRow() {
  return (
    <SheetClose
      className={cn(SHEET_ROW, LABEL, "justify-center border-t border-rule")}
    >
      Cancel
    </SheetClose>
  );
}

/**
 * The shape the top strip's menus take on a phone: a list of touch-sized rows
 * rising from the bottom edge, within thumb reach of the strip that opened it.
 * The title names the sheet for a screen reader; on screen the rows say what
 * it is.
 */
export function BottomSheet({
  title,
  trigger,
  open,
  onOpenChange,
  children,
}: {
  title: string;
  trigger: ReactNode;
  /** Controlled open state, for a sheet whose trigger can change under it. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side={"bottom"}
        className={cn("max-h-[80dvh] gap-0 overflow-y-auto py-2")}
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <SheetTitle className={"sr-only"}>{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
