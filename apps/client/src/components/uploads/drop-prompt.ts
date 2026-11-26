import { ENTITIES } from "@/entities";
import type { EntityKind } from "@workspace/api/api";

/** The parent kind a `FileUploader` drop zone attaches uploads to. */
export type AttachTo = EntityKind;

/** Looks up the drop prompt for `attachTo`, falling back for callers that pass none. */
export function dropPromptFor(attachTo?: AttachTo): string {
  return attachTo ? ENTITIES[attachTo].dropPrompt : ENTITIES.project.dropPrompt;
}
