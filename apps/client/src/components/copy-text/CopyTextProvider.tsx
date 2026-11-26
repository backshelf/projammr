"use client";

import { copyText } from "@/lib/copy-text";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

type CopyOptions = {
  /** Toast shown once the value lands on the clipboard. Omit for silent success. */
  success?: string;
};

/** Resolves to whether the value landed on the clipboard without the fallback dialog. */
type CopyFn = (value: string, options?: CopyOptions) => Promise<boolean>;

const CopyTextContext = createContext<CopyFn | null>(null);

/**
 * Mounts the manual-copy fallback dialog once for the signed-in shell and
 * shares one `copy` function through context, so a call site never renders
 * its own dialog. `copyText` covers the Clipboard API and the
 * `execCommand` fallback; this only takes over once both have failed, which
 * happens outside a secure context — plain `http://` on a LAN address is the
 * common case — and shows no error toast of its own, since the dialog is the
 * fallback.
 */
export function CopyTextProvider({ children }: { children: ReactNode }) {
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  const copy = useCallback<CopyFn>(async (value, options) => {
    const ok = await copyText(value);
    if (ok) {
      if (options?.success) toast.success(options.success);
      return true;
    }
    setPendingValue(value);
    return false;
  }, []);

  return (
    <CopyTextContext value={copy}>
      {children}
      <ManualCopyDialog
        value={pendingValue}
        onOpenChange={(open) => {
          if (!open) setPendingValue(null);
        }}
      />
    </CopyTextContext>
  );
}

/**
 * Copies text to the clipboard, opening a manual-copy dialog when neither the
 * Clipboard API nor the `execCommand` fallback works, and resolving to
 * whether the automatic copy landed. Must be called under a
 * `CopyTextProvider`, which the signed-in shell mounts once.
 */
export function useCopyText(): CopyFn {
  const copy = use(CopyTextContext);
  if (!copy) {
    throw new Error("useCopyText must be used within a CopyTextProvider");
  }
  return copy;
}

function ManualCopyDialog({
  value,
  onOpenChange,
}: {
  value: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  return (
    <Dialog open={value != null} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={inputRef}>
        <DialogHeader>
          <DialogTitle>Copy to clipboard</DialogTitle>
          <DialogDescription>
            This browser blocked the copy. Copy the selected text instead.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor={inputId} className="sr-only">
            Text to copy
          </FieldLabel>
          <Input
            ref={inputRef}
            id={inputId}
            value={value ?? ""}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
        </Field>
      </DialogContent>
    </Dialog>
  );
}
