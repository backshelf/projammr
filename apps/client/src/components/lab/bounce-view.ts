import type { BounceState } from "@/components/music-player/player-store";

export type BounceView = {
  /** The line beside the button. */
  caption: string;
  /** How much of the print has been drawn, 0..1: the render's own progress,
   *  all of it once the render is done, none while nothing has run or after
   *  a failure. */
  printed: number;
  /** A failed bounce's caption reads as the error it is. */
  failed: boolean;
  /** Any of the three phases that keep the button busy. */
  running: boolean;
  /** The finished attachment's name, for the link back to it. */
  doneName: string | null;
};

/**
 * What the Bounce section shows for each point in a bounce's life. The
 * render prints the version's waveform left to right as it goes; the encode
 * and the upload hold the finished print while the caption says what is
 * happening; a finished bounce keeps the print and names the attachment.
 */
export function bounceView(status: BounceState | null): BounceView {
  const idle = {
    printed: 0,
    failed: false,
    running: false,
    doneName: null,
  };
  if (!status)
    return { ...idle, caption: "Print what you hear as an attachment" };
  switch (status.phase) {
    case "rendering":
      return {
        ...idle,
        caption: `Rendering ${Math.round(status.fraction * 100)}%`,
        printed: status.fraction,
        running: true,
      };
    case "encoding":
      return { ...idle, caption: "Encoding", printed: 1, running: true };
    case "uploading":
      return {
        ...idle,
        caption: `Uploading ${Math.round(status.fraction * 100)}%`,
        printed: 1,
        running: true,
      };
    case "done":
      return { ...idle, caption: "Bounced", printed: 1, doneName: status.name };
    case "failed":
      return { ...idle, caption: status.reason, failed: true };
  }
}
