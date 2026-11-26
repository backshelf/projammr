"use client";

import { uploadLimit } from "@/components/uploads/upload-client";
import { useEffect, useState } from "react";

/**
 * The largest file, in bytes, the upload routes take right now, read from
 * `GET /api/uploads/limits` when the drop zone mounts — the instance can change
 * it at any time, so no build-time number stands in for it. Null until the
 * server answers, and when it could not.
 */
export function useUploadLimit(): number | null {
  const [maxBytes, setMaxBytes] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    void (async () => {
      const limit = await uploadLimit();
      if (current && typeof limit === "number") setMaxBytes(limit);
    })();
    return () => {
      current = false;
    };
  }, []);

  return maxBytes;
}
