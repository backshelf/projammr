"use client";

import { imageUrl } from "@/lib/utils";
import { IconEye } from "@tabler/icons-react";
import type { Image } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent } from "@workspace/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import ImageComponent from "next/image";
import { useState } from "react";

export default function SettingsImageGrid({ images }: { images: Image[] }) {
  const [selectedImage, setSelectedImage] = useState<Image | null>(null);

  if (images.length === 0) {
    return (
      <div className={"py-8 text-center text-ink-soft"}>
        No images uploaded yet.
      </div>
    );
  }

  return (
    <>
      <div className={"grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4"}>
        {images.map((image) => (
          <Card key={image.id} className="group overflow-hidden">
            <CardContent className={"p-0"}>
              <div className={"relative aspect-square"}>
                <ImageComponent
                  src={imageUrl(image.assetPath, 256)}
                  alt={image.name}
                  fill
                  className={
                    "object-cover motion-reveal group-hover:opacity-80"
                  }
                  sizes="(max-width: 640px) 50vw, 33vw"
                />
              </div>
              <div
                className={
                  "flex items-center justify-between p-2 text-small text-ink-soft"
                }
              >
                <span className={"truncate"}>{image.name}</span>
                <div className={"flex gap-1"}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setSelectedImage(image)}
                    className="h-6 w-6"
                  >
                    <IconEye size={14} />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog
        open={selectedImage != null}
        onOpenChange={(open) => !open && setSelectedImage(null)}
      >
        <DialogContent className={"sm:max-w-lg"}>
          {selectedImage && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedImage.name}</DialogTitle>
              </DialogHeader>
              <ImageComponent
                src={imageUrl(selectedImage.assetPath, 1024)}
                alt={selectedImage.name}
                width={600}
                height={600}
                className={
                  "max-h-[70vh] w-full rounded-(--radius) bg-paper-sunk object-contain"
                }
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
