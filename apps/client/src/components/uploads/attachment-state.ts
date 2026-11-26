import type { UploadRowPhase } from "@/components/uploads/upload-row";

/** The look an upload row can have; the row's `data-state`. */
type AttachmentState = "uploading" | "processing" | "error" | "done";

/** Maps an upload row's phase to the one value that drives how the row looks
 *  (the shimmering name, the danger ink), instead of a second parallel switch. */
export function attachmentStateFor(phase: UploadRowPhase): AttachmentState {
  switch (phase) {
    case "uploading":
      return "uploading";
    case "following":
      return "processing";
    case "failed":
      return "error";
    case "done":
      return "done";
  }
}
