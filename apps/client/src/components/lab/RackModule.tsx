"use client";

import { RACK_PILL_WIDTH } from "@/components/lab/rack-columns";
import { HeightReveal } from "@workspace/ui/components/height-reveal";
import { TogglePill } from "@workspace/ui/components/toggle-pill";
import type { ReactNode } from "react";

/**
 * One rack module: its on/off pill, an optional control beside it that only
 * means something while the module runs (the reverb's room), and its body.
 * Engaging the module opens the body in height, so the modules under it
 * glide down instead of jumping; switching it off folds the body away. The
 * one shape EQ, Comp and Verb share, so they engage the same way.
 */
export function RackModule({
  label,
  on,
  onChange,
  aside,
  children,
}: {
  label: string;
  on: boolean;
  onChange: (on: boolean) => void;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <TogglePill
          pressed={on}
          onPressedChange={onChange}
          className={RACK_PILL_WIDTH}
        >
          {label}
        </TogglePill>
        {aside && <HeightReveal open={on}>{aside}</HeightReveal>}
      </div>
      <HeightReveal open={on}>
        <div className="flex flex-col gap-2.5 pt-3 pb-1">{children}</div>
      </HeightReveal>
    </div>
  );
}
