import {
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";

/**
 * Pointer + touch sensors shared by every dnd-kit drag surface, with room for
 * a surface's own extra sensors (e.g. keyboard reordering). The pointer
 * sensor needs a small move before it claims the gesture so a click still
 * fires; the touch sensor needs a short hold instead, so a plain swipe is
 * free to scroll the page and a long-press starts the drag.
 */
export function useDragSensors(...extra: Parameters<typeof useSensors>) {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
    ...extra
  );
}
