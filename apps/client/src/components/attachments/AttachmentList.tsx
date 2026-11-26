"use client";

import { AppAttachment } from "@/components/attachments/AppAttachment";
import { FileUploader } from "@/components/uploads/FileUploader";

import type { AttachedAsset } from "@workspace/api/api";
import { AnimatePresence, m, OPTICAL } from "@workspace/ui/lib/motion";

export const AttachmentList = ({
  attachments,
  attachTo,
  parentId,
  trackId,
}: {
  attachments: AttachedAsset[];
  attachTo: "project" | "collection" | "track" | "session";
  parentId: number;
  trackId?: number | null;
}) => (
  <div className={"@container"}>
    {attachments.length > 0 && (
      // Columns sit apart; rows meet, since each tile draws its own hairline.
      <div
        className={
          "mb-4 grid grid-cols-1 gap-x-6 @md:grid-cols-2 @3xl:grid-cols-3"
        }
      >
        {/* A file that arrives after the list does fades in where it lands,
              and one that is deleted fades out of it. */}
        <AnimatePresence initial={false}>
          {attachments.map((asset) => (
            <m.div
              key={asset.id}
              variants={OPTICAL}
              initial={"hidden"}
              animate={"shown"}
              exit={"leaving"}
            >
              <AppAttachment
                asset={asset}
                attachTo={attachTo}
                parentId={parentId}
                trackId={trackId}
              />
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    )}
    <FileUploader attachTo={attachTo} parentId={parentId} />
  </div>
);
