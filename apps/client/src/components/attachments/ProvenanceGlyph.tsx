import type { ProvenanceAsset } from "@/components/attachments/AssetProvenance";
import { IconDeviceDesktop, IconUser } from "@tabler/icons-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { cn } from "@workspace/ui/lib/utils";

/**
 * Where a file came from, at avatar size: the machine that rendered a
 * file, or the person who uploaded a web one.
 */
export function ProvenanceGlyph({
  asset,
  className,
}: {
  asset: ProvenanceAsset;
  className?: string;
}) {
  if (asset.localFilepath) {
    return (
      <span
        role="img"
        aria-label={asset.localFileMachineName ?? "Local file"}
        className={cn(
          "flex size-6 shrink-0 items-center justify-center text-ink-soft",
          className
        )}
      >
        <IconDeviceDesktop aria-hidden className="size-4" />
      </span>
    );
  }

  const user = asset.uploadedBy;
  return (
    <Avatar size="sm" className={className}>
      {user?.image && <AvatarImage src={user.image} alt="" />}
      <AvatarFallback>
        {user ? (
          user.name.slice(0, 1).toUpperCase()
        ) : (
          <IconUser aria-hidden className="size-3" />
        )}
      </AvatarFallback>
    </Avatar>
  );
}
