"use client";

import { IconLock, IconLockOpen } from "@tabler/icons-react";
import { TogglePill } from "@workspace/ui/components/toggle-pill";
import { AnimatePresence, FADE, LEAVE, m } from "@workspace/ui/lib/motion";

/**
 * The lock on a member default: pressed, the value holds for every member
 * below this scope, whose own controls go still and say who locked them.
 * Shown only where the caller may lock at the row's scope.
 */
export function LockToggle({
  locked,
  label,
  onChange,
}: {
  locked: boolean;
  /** The setting's label, for the toggle's accessible name. */
  label: string;
  onChange: (locked: boolean) => void;
}) {
  const Glyph = locked ? IconLock : IconLockOpen;

  return (
    <TogglePill
      pressed={locked}
      onPressedChange={onChange}
      aria-label={`Lock ${label} for every member`}
      className="shrink-0"
    >
      {/* The shackle drops shut or lifts: the one moment the lock spends. */}
      <span className="relative inline-grid size-[0.8125rem] place-items-center">
        <AnimatePresence initial={false} mode="popLayout">
          <m.span
            key={locked ? "locked" : "open"}
            className="inline-grid place-items-center"
            initial={{ opacity: 0, y: locked ? -2 : 2 }}
            animate={{ opacity: 1, y: 0, transition: FADE.quick }}
            exit={{ opacity: 0, transition: LEAVE.quick }}
          >
            <Glyph aria-hidden />
          </m.span>
        </AnimatePresence>
      </span>
      Lock
    </TogglePill>
  );
}
