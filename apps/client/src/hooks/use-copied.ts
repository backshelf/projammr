"use client";

import { useCopyText } from "@/components/copy-text/CopyTextProvider";
import { useState } from "react";

/** How long a copy button keeps saying it copied. */
const COPIED_MS = 1500;

/**
 * `copy(text)` puts the text on the clipboard (with the manual fallback of
 * `useCopyText`) and turns `copied` true for a moment once it has.
 */
export function useCopied() {
  const [copied, setCopied] = useState(false);
  const copyText = useCopyText();

  const copy = async (text: string) => {
    if (await copyText(text)) {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_MS);
    }
  };

  return { copied, copy };
}
