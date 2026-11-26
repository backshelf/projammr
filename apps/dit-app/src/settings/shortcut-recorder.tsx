import { useState, type JSX, type KeyboardEvent } from "react";
import { IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Kbd } from "@workspace/ui/components/kbd";

import { captureShortcut, shortcutCaps } from "../accelerator";

/**
 * Records the panel's global shortcut by pressing it. While recording the button takes every key (only Tab passes,
 * so focus can always leave) and a bare Esc cancels; a press that needs a modifier it lacks is refused through
 * `onRefusal`, for the row to say in its own words, and recording goes on. Losing focus cancels. It hands up the
 * accelerator and never checks it against anything: the app registers it and says if another app holds it.
 *
 * Adapted from the web client's key capture, without chords.
 */
export function ShortcutRecorder({
  id,
  accelerator,
  onCapture,
  onClear,
  onRefusal,
  describedBy,
}: {
  id: string;
  accelerator: string | null;
  onCapture: (accelerator: string) => void;
  onClear: () => void;
  /** Why the last press cannot be a shortcut; null once recording ends. */
  onRefusal: (refusal: string | null) => void;
  describedBy?: string;
}): JSX.Element {
  const [recording, setRecording] = useState(false);

  function stop(): void {
    setRecording(false);
    onRefusal(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!recording || event.key === "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (event.key === "Escape") {
      stop();
      return;
    }
    const capture = captureShortcut(event);
    if (capture === null) return;
    if ("refusal" in capture) {
      onRefusal(capture.refusal);
      return;
    }
    stop();
    onCapture(capture.accelerator);
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        id={id}
        variant="outline"
        aria-describedby={describedBy}
        aria-label={
          recording
            ? "Press the new keys for the global shortcut"
            : `Global shortcut: ${accelerator ?? "none"}. Press to change it.`
        }
        onClick={() => setRecording(true)}
        onKeyDown={onKeyDown}
        onBlur={stop}
        className="min-w-28"
      >
        {recording ? (
          <span className="text-ink-soft">Press keys…</span>
        ) : accelerator ? (
          <span className="flex items-center gap-0.5">
            {shortcutCaps(accelerator).map((cap) => (
              <Kbd key={cap} variant="bare">
                {cap}
              </Kbd>
            ))}
          </span>
        ) : (
          <span className="text-ink-soft">Record</span>
        )}
      </Button>
      {accelerator && !recording && (
        <IconButton aria-label="Clear the global shortcut" onClick={onClear}>
          <IconX />
        </IconButton>
      )}
    </div>
  );
}
