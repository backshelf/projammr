"use client";

import {
  type ConvertRequest,
  convertOutcome,
  isConvertRequestRunning,
  shouldSettleConvertRequest,
} from "@/components/uploads/convert-outcome";
import { useTrackedJob } from "@/components/uploads/use-tracked-job";
import { storageLimitFailure, storageLimitMessage } from "@/lib/storage-limit";
import { browserApi } from "@/lib/browser-api";
import { downloadBlob } from "@/lib/download";
import { mediaDownloadUrl } from "@/lib/utils";
import { IconArrowRight, IconDownload } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Label } from "@workspace/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Spinner } from "@workspace/ui/components/spinner";
import { useLatestRef } from "@workspace/ui/hooks/use-latest-ref";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const CONVERT_FORMATS = [
  ".wav",
  ".flac",
  ".aiff",
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
] as const;
type ConvertFormat = (typeof CONVERT_FORMATS)[number];

const MP3_BITRATES = ["320", "256", "192", "128", "96", "64", "32", "16"];

const LOSSY_EXTENSIONS = [".mp3", ".aac", ".m4a", ".ogg", ".opus", ".wma"];

function isLossy(path: string) {
  const lower = path.toLowerCase();
  return LOSSY_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function extensionOf(path: string) {
  const match = /\.[^.]+$/.exec(path.toLowerCase());
  return match ? match[0] : "";
}

function formatLabel(extension: string) {
  return extension.replace(".", "").toUpperCase();
}

function basename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

async function downloadViaBlob(url: string, fileName: string) {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  downloadBlob(await res.blob(), fileName);
}

/**
 * What converting from `source` to `target` does to the audio. A lossy source
 * can never regain detail, so re-encoding it loses more and expanding it into a
 * lossless container only costs disk space.
 */
function describeConversion(source: string, target: ConvertFormat) {
  if (source === target) return "";
  const sourceLossy = isLossy(source);
  const targetLossy = isLossy(target);

  if (sourceLossy && !targetLossy)
    return "Output file will be low quality, input is lossy.";
  if (sourceLossy) return "Encoding lossy to lossy file.";
  if (targetLossy) return "";
  return "Lossless. Every sample is preserved.";
}

function fidelityOf(extension: string, kbps?: string) {
  if (!isLossy(extension)) return "lossless";
  return kbps ? `${kbps} kbps · lossy` : "lossy";
}

export function DownloadAssetDialog({
  assetId,
  assetPath,
  fileName,
  allowConvert = true,
  open,
  onOpenChange,
  children,
}: {
  assetId: number;
  assetPath: string;
  fileName?: string;
  allowConvert?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: React.ReactNode;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = open ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;
  const setOpenRef = useLatestRef(setOpen);
  const [downloading, setDownloading] = useState(false);
  const [convertRequest, setConvertRequest] = useState<ConvertRequest | null>(
    null
  );
  // Bumped on every `convert()` call, even one that hands back the very same
  // job id as before (the server reuses a conversion whose output still
  // survives): `shouldSettleConvertRequest` keys off this, not the job, so a
  // repeat request is never mistaken for the one already handled.
  const nextRequestIdRef = useRef(0);
  // The format label a conversion was started for, read back into its own
  // messages so a later change to the `format` select cannot relabel one
  // already in flight.
  const [convertFormatLabel, setConvertFormatLabel] = useState("");
  const { job: convertJob, hasTrackedJob } = useTrackedJob(
    convertRequest?.jobId,
    convertRequest?.requestId
  );
  const outcome = convertRequest != null ? convertOutcome(convertJob) : null;
  const converting = isConvertRequestRunning(outcome, hasTrackedJob);

  const name = fileName ?? basename(assetPath);
  const sourceExtension = extensionOf(name) || extensionOf(assetPath);
  const [format, setFormat] = useState<ConvertFormat>(".mp3");
  const [kbps, setKbps] = useState("320");
  const [mode, setMode] = useState<"original" | "convert">("original");

  const busy = downloading || converting;
  const isConvert = allowConvert && mode === "convert";
  const targetLabel = isConvert
    ? formatLabel(format)
    : formatLabel(sourceExtension);
  const targetFidelity = isConvert
    ? fidelityOf(format, format === ".mp3" ? kbps : undefined)
    : fidelityOf(sourceExtension);

  // The most recent request this effect has already fired its side effect
  // for, so a later render that reads the same settled outcome — a jobs-map
  // snapshot handing back a new `Job` object with the same fields, or a
  // repeat conversion reusing the very same job id — cannot download or toast
  // a second time. A genuinely new request always carries its own id, so it
  // still gets its one settle even when the job underneath it is unchanged.
  const handledRequestIdRef = useRef<number | null>(null);

  // Reads the queued conversion's outcome straight off its live job row
  // rather than a poll of its own, and fires the matching side effect once it
  // settles: the file is fetched on `done`, and every other outcome just
  // reports itself.
  useEffect(() => {
    if (convertRequest == null) return;
    const settled = convertOutcome(convertJob);
    // Narrows `settled` to "done" | "failed" for TypeScript below;
    // `shouldSettleConvertRequest` re-derives the same test so the rule
    // itself stays in one, independently tested place.
    if (settled.kind === "pending" || settled.kind === "running") return;
    if (
      !shouldSettleConvertRequest(
        convertRequest,
        settled,
        handledRequestIdRef.current
      )
    ) {
      return;
    }
    handledRequestIdRef.current = convertRequest.requestId;

    if (settled.kind === "failed") {
      toast.error(
        `Couldn't convert to ${convertFormatLabel}: ${settled.message}`
      );
      return;
    }

    if (!settled.output.url) {
      toast.error(`Couldn't convert to ${convertFormatLabel}.`);
      return;
    }
    downloadViaBlob(
      mediaDownloadUrl(settled.output.url),
      settled.output.name ?? basename(settled.output.url)
    )
      .then(() => setOpenRef.current(false))
      .catch(() =>
        toast.error("Download failed. Check your connection and try again.")
      );
  }, [convertRequest, convertJob, convertFormatLabel, setOpenRef]);

  const downloadOriginal = async () => {
    setDownloading(true);
    try {
      await downloadViaBlob(mediaDownloadUrl(assetPath), name);
      setOpen(false);
    } catch {
      toast.error("Download failed. Check your connection and try again.");
    } finally {
      setDownloading(false);
    }
  };

  const convert = async () => {
    const label = formatLabel(format);
    try {
      const { data, error } = await browserApi.POST(
        "/api/assets/{id}/convert",
        {
          params: { path: { id: String(assetId) } },
          body: {
            format,
            ...(format === ".mp3" ? { kbps: Number(kbps) } : {}),
          },
        }
      );
      if (error || !data) {
        const limit = storageLimitFailure(error);
        toast.error(
          limit ? storageLimitMessage(limit) : `Couldn't convert to ${label}.`
        );
        return;
      }
      setConvertFormatLabel(label);
      nextRequestIdRef.current += 1;
      setConvertRequest({
        jobId: data.jobId,
        requestId: nextRequestIdRef.current,
      });
    } catch {
      toast.error(`Couldn't convert to ${label}.`);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}
      <DialogContent className="bg-paper">
        <DialogHeader>
          <DialogTitle>Download</DialogTitle>
          <DialogDescription className="truncate font-mono" title={name}>
            {name}
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex items-center gap-2 font-mono text-small tabular-nums"
          aria-live="polite"
        >
          <span className="text-ink-soft">
            {formatLabel(sourceExtension)} · {fidelityOf(sourceExtension)}
          </span>
          {isConvert && (
            <>
              <IconArrowRight className="size-3.5 shrink-0 text-ink-faint" />
              <span className="text-ink">
                {targetLabel} · {targetFidelity}
              </span>
            </>
          )}
        </div>

        {allowConvert && (
          <>
            <div
              role="radiogroup"
              aria-label="What to download"
              className="grid grid-cols-2 gap-1 rounded-md bg-paper-sunk p-1"
            >
              {(
                [
                  ["original", "Original"],
                  ["convert", "Convert"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  onClick={() => setMode(value)}
                  className={cn(
                    "rounded-sm px-2 py-1 text-small motion-ink focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-none",
                    mode === value
                      ? "bg-paper text-ink"
                      : "text-ink-soft hover:text-ink"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {isConvert && (
              <div className="flex flex-col gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="download-format">Format</Label>
                  <Select
                    value={format}
                    onValueChange={(v) => setFormat(v as ConvertFormat)}
                    items={CONVERT_FORMATS.map((f) => ({
                      value: f,
                      label: formatLabel(f),
                    }))}
                  >
                    <SelectTrigger id="download-format">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONVERT_FORMATS.map((f) => (
                        <SelectItem key={f} value={f} className="font-mono">
                          {formatLabel(f)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {format === ".mp3" && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="download-bitrate">Bitrate</Label>
                    <Select
                      value={kbps}
                      onValueChange={setKbps}
                      items={MP3_BITRATES.map((b) => ({
                        value: b,
                        label: `${b} kbps`,
                      }))}
                    >
                      <SelectTrigger id="download-bitrate">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MP3_BITRATES.map((b) => (
                          <SelectItem
                            key={b}
                            value={b}
                            className="font-mono tabular-nums"
                          >
                            {b} kbps
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <p className="text-small/relaxed text-ink-soft">
                  {describeConversion(sourceExtension, format)}
                </p>

                <p
                  role="status"
                  className="min-h-4 font-mono text-small text-ink-soft tabular-nums"
                >
                  {outcome?.kind === "running"
                    ? `Converting… ${outcome.percent}%`
                    : converting
                      ? "Converting…"
                      : null}
                </p>
              </div>
            )}
          </>
        )}

        <DialogFooter showCloseButton>
          <Button
            onClick={isConvert ? convert : downloadOriginal}
            disabled={busy}
          >
            {busy ? <Spinner /> : <IconDownload />}
            {isConvert ? `Download ${targetLabel}` : "Download original"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
