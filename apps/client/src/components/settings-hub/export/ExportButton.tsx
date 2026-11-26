"use client";

import { toastActionResult } from "@/lib/action-toast";
import { downloadBlob } from "@/lib/download";
import { IconDownload } from "@tabler/icons-react";
import { isActionError } from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { pluralizeCount } from "@workspace/session-diff/format";
import { useState } from "react";
import { exportSettings } from "../api";
import { useHub } from "../hub-rows";

const twoDigits = (n: number) => String(n).padStart(2, "0");

/** The name an export downloads under: the day it was made, in the reader's own calendar. */
const exportFileName = (date: Date) =>
  `projammr-settings-${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}.json`;

/**
 * Downloads the user's own settings as a file an import takes back: the
 * values they set themselves, not what they inherit, so a fresh account that
 * imports it holds exactly what they had set.
 */
export function ExportButton() {
  const hub = useHub();
  const [pending, setPending] = useState(false);
  const target = hub.target("user");
  if (target?.scope !== "user") return null;

  const download = async () => {
    setPending(true);
    try {
      const file = await exportSettings(target.id);
      if (isActionError(file)) {
        toastActionResult({ ok: false, message: file.error });
        return;
      }
      downloadBlob(
        new Blob([`${JSON.stringify(file, null, 2)}\n`], {
          type: "application/json",
        }),
        exportFileName(new Date())
      );
      toastActionResult({
        ok: true,
        message: `Exported ${pluralizeCount(Object.keys(file.values).length, "setting")}`,
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={() => void download()}
    >
      {pending ? (
        <Spinner aria-hidden data-icon="inline-start" />
      ) : (
        <IconDownload aria-hidden data-icon="inline-start" />
      )}
      Export settings
    </Button>
  );
}
