import * as React from "react";

/**
 * A ref that always holds the most recently committed value.
 *
 * For callbacks that outlive the render that created them — a debounced save,
 * an unmount cleanup, a handler fired long after the keystroke that scheduled
 * it — reading through this ref gets the current value instead of the one
 * captured when the callback was built.
 */
export function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  React.useEffect(() => {
    ref.current = value;
  });
  return ref;
}
