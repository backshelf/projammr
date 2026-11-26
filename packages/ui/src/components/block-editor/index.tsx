"use client";

import { Arrive } from "@workspace/ui/components/layout/arrive";
import { Suspense } from "react";
import {
  EDITOR_VARIANTS,
  type EditorVariant,
  type VariantProps,
} from "./variants";

export type { EditorVariant, VariantProps };

export type BlockEditorProps = VariantProps & {
  /** Which editor to mount. Chosen once — a mounted editor cannot change it. */
  variant?: EditorVariant;
};

export const BlockEditor = ({
  variant = "document",
  ...props
}: BlockEditorProps) => {
  const Variant = EDITOR_VARIANTS[variant];

  // The variant is a lazy chunk that only ever mounts on the client, after
  // the page around it: it fades into the place the fallback held rather
  // than appearing the moment its code lands.
  return (
    <Suspense fallback={<div className="min-h-6" />}>
      <Arrive>
        <Variant {...props} />
      </Arrive>
    </Suspense>
  );
};
