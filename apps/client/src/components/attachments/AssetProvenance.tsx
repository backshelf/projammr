"use client";

import { ProvenanceGlyph } from "@/components/attachments/ProvenanceGlyph";
import { copyText } from "@/lib/copy-text";
import { IconCopy } from "@tabler/icons-react";
import type { Asset, AssetWithContext } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  FingerprintMark,
  barsFromFingerprint,
} from "@workspace/ui/components/fingerprint-mark";
import { FloatingNote } from "@workspace/ui/components/floating-note";
import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@workspace/ui/components/popover";
import { AnimatePresence } from "@workspace/ui/lib/motion";
import { LABEL } from "@workspace/ui/lib/shell";
import { type ReactElement, useRef, useState } from "react";
import { toast } from "sonner";

export type ProvenanceAsset = Pick<
  Asset,
  | "id"
  | "name"
  | "createdAt"
  | "localFilepath"
  | "localFileCreatedAt"
  | "localFileUpdatedAt"
  | "localFileMachineName"
  | "fingerprint"
> & { uploadedBy?: AssetWithContext["uploadedBy"] };

/** "RENDERED ON X" for a file with a local path, "UPLOADED BY X" for a web upload. */
export function provenanceLine(asset: ProvenanceAsset): string {
  if (asset.localFilepath) {
    return asset.localFileMachineName
      ? `RENDERED ON ${asset.localFileMachineName.toUpperCase()}`
      : "RENDERED";
  }
  return asset.uploadedBy
    ? `UPLOADED BY ${asset.uploadedBy.name.toUpperCase()}`
    : "UPLOADED";
}

/**
 * Open state for an `AssetProvenancePopover` chosen from a row menu around the
 * same trigger. Choosing Details only marks it pending; the popover opens from
 * the menu's `onOpenChangeComplete(false)`, once the menu has closed and handed
 * focus back to its trigger, so the popover takes focus last. Opened from the
 * item itself, which of the two moved focus last would be down to timing.
 */
export function useMenuDetails() {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const pendingRef = useRef(false);
  return {
    detailsOpen,
    setDetailsOpen,
    chooseDetails: () => {
      pendingRef.current = true;
    },
    onMenuOpenChangeComplete: (menuOpen: boolean) => {
      if (menuOpen || !pendingRef.current) return;
      pendingRef.current = false;
      setDetailsOpen(true);
    },
  };
}

function Row({
  label,
  children,
}: {
  label: string;
  children?: ReactElement | string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className={`${LABEL} text-ink-soft`}>{label}</dt>
      <dd>
        <MetadataItem>{children}</MetadataItem>
      </dd>
    </div>
  );
}

/**
 * Where a file came from. A file with a local path lists its path, machine, dates and
 * fingerprint mark; a web upload has only its uploader and upload date.
 */
export function AssetProvenance({
  asset,
}: {
  asset: ProvenanceAsset;
}): ReactElement {
  const format = useFormat();
  const optionalDateTime = (value: string | null) =>
    value ? format.dateTime(value) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ProvenanceGlyph asset={asset} />
        <p
          className={`${LABEL} min-w-0 [overflow-wrap:anywhere] text-ink-soft`}
        >
          {provenanceLine(asset)}
        </p>
      </div>
      {asset.localFilepath ? (
        <dl className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-0.5">
            <dt className={`${LABEL} text-ink-soft`}>Path</dt>
            <dd className="font-mono text-micro [overflow-wrap:anywhere] text-ink">
              {asset.localFilepath}
            </dd>
          </div>
          <Row label="On">{asset.localFileMachineName}</Row>
          <Row label="Modified">
            {optionalDateTime(asset.localFileUpdatedAt)}
          </Row>
          <Row label="Created">
            {optionalDateTime(asset.localFileCreatedAt)}
          </Row>
          <Row label="Mark">
            {barsFromFingerprint(asset.fingerprint).length > 0 ? (
              <FingerprintMark
                fingerprint={asset.fingerprint}
                title="File fingerprint"
                className="text-ink"
              />
            ) : null}
          </Row>
        </dl>
      ) : (
        <p className="text-small text-ink-soft tabular-nums">
          {format.dateTime(asset.createdAt)}
        </p>
      )}
    </div>
  );
}

/**
 * The read-only glance note beside `anchor`. It is presentation only, so the
 * same facts must be reachable through `AssetProvenancePopover`.
 */
export function AssetProvenanceNote({
  asset,
  anchor,
}: {
  asset: ProvenanceAsset;
  anchor: HTMLElement | null;
}): ReactElement {
  return (
    <AnimatePresence>
      {anchor && (
        <FloatingNote
          key="asset-provenance-note"
          anchor={anchor}
          placement="beside"
          className="w-72 p-3.5 px-4"
        >
          <AssetProvenance asset={asset} />
        </FloatingNote>
      )}
    </AnimatePresence>
  );
}

/**
 * The provenance block in a popover anchored to `children`, with Copy path for
 * a file with a local path.
 */
export function AssetProvenancePopover({
  asset,
  open,
  onOpenChange,
  children,
}: {
  asset: ProvenanceAsset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactElement;
}): ReactElement {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { localFilepath } = asset;

  const copyPath = async () => {
    if (!localFilepath) return;
    if (await copyText(localFilepath)) toast.success("Path copied");
    else toast.error("Couldn't copy the path");
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor ref={setAnchor}>{children}</PopoverAnchor>
      <PopoverContent
        anchor={anchor}
        align="start"
        className="w-72 gap-3 p-3.5 px-4"
      >
        <AssetProvenance asset={asset} />
        {localFilepath && (
          <div className="flex flex-wrap gap-2 border-t border-rule pt-3">
            <Button variant="outline" size="sm" onClick={copyPath}>
              <IconCopy data-icon="inline-start" />
              Copy path
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
