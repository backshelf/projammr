"use client";

/** Has the browser save what `url` points at as `fileName`. */
function triggerDownload(url: string, fileName: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Has the browser save `blob` as `fileName`. */
export function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  triggerDownload(objectUrl, fileName);
  URL.revokeObjectURL(objectUrl);
}
