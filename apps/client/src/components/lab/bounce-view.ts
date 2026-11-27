import type { BounceState } from "@/components/music-player/player-store";

export type BounceView = {
  /** The line beside the buttons. */
  caption: string;
  /** How much of the print has been drawn, 0..1: the render's own progress,
   *  all of it once the render is done, none while nothing has run or after
   *  a render failure. */
  printed: number;
  /** A failed bounce or upload's caption reads as the error it is. */
  failed: boolean;
  /** Which action is currently running, or null when idle. */
  running: "bounce" | "upload" | null;
  /** The locally downloaded bounce's name before any opt-in upload. */
  downloadedName: string | null;
  /** The uploaded attachment's name, for the link back to the track. */
  uploadedName: string | null;
  /** Whether the quick opt-in Upload button is available. */
  canUpload: boolean;
};

/**
 * What the Bounce section shows for each point in a bounce's life. The
 * render prints the version's waveform left to right as it goes; the encode
 * holds the finished print until the file downloads locally; a downloaded
 * bounce names the file and offers an opt-in Upload action; uploading tracks
 * progress and a finished upload links the attachment by name.
 */
export function bounceView(status: BounceState | null): BounceView {
  const idle: Omit<BounceView, "caption"> = {
    printed: 0,
    failed: false,
    running: null,
    downloadedName: null,
    uploadedName: null,
    canUpload: false,
  };
  if (!status) {
    return { ...idle, caption: "Print what you hear" };
  }
  switch (status.phase) {
    case "rendering":
      return {
        ...idle,
        caption: `Rendering ${Math.round(status.fraction * 100)}%`,
        printed: status.fraction,
        running: "bounce",
      };
    case "encoding":
      return { ...idle, caption: "Encoding", printed: 1, running: "bounce" };
    case "downloaded":
      return {
        ...idle,
        caption: "Downloaded",
        printed: 1,
        downloadedName: status.name,
        canUpload: status.canUpload,
      };
    case "uploading":
      return {
        ...idle,
        caption: `Uploading ${Math.round(status.fraction * 100)}%`,
        printed: 1,
        running: "upload",
        canUpload: true,
      };
    case "done":
      return {
        ...idle,
        caption: "Uploaded",
        printed: 1,
        uploadedName: status.name,
      };
    case "failed":
      return {
        ...idle,
        caption: status.reason,
        printed: status.canUpload ? 1 : 0,
        failed: true,
        canUpload: Boolean(status.canUpload),
      };
  }
}
