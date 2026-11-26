"use client";

import {
  useAppearance,
  type AppearanceValue,
} from "@workspace/ui/lib/appearance";
import { SPRING } from "@workspace/ui/lib/motion";
import {
  domMax,
  LazyMotion,
  MotionConfig,
  type MotionConfigProps,
} from "motion/react";

/** Motion's own reduced-motion setting for each `data-motion` value: `user`
 *  follows the OS, the other two pin it whatever the OS says. */
const REDUCED_MOTION_CONFIG: Record<
  AppearanceValue<"motion">,
  NonNullable<MotionConfigProps["reducedMotion"]>
> = {
  system: "user",
  reduce: "always",
  full: "never",
};

/**
 * Mounts Motion's feature set once for the whole tree and pins the two
 * global choices: the default transition every `m` element inherits, and
 * how reduced motion is decided — the OS preference, unless `data-motion` on
 * `<html>` overrides it, followed live. Reduced, Motion drops transform and
 * layout animation and keeps opacity and colour, which is the optical half of
 * every state change.
 *
 * `strict` makes a stray `motion` import throw, so the feature bundle is the
 * only one shipped.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const motion = useAppearance("motion");
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig
        reducedMotion={REDUCED_MOTION_CONFIG[motion]}
        transition={SPRING.control}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  );
}
