import { useFormat } from "@workspace/ui/components/format-provider";
import { LoudnessUnit } from "@workspace/ui/components/loudness/loudness-unit";
import { formatSignedDecimal } from "@workspace/ui/lib/loudness";
import { cn } from "@workspace/ui/lib/utils";

export function LoudnessLabel({
  lufs,
  truePeakDb,
  className,
}: {
  lufs: number | null;
  truePeakDb: number | null;
  className?: string;
}) {
  const format = useFormat();

  if (lufs == null) {
    return (
      <span className={cn("shrink-0 text-ink-soft", className)}>
        measuring…
      </span>
    );
  }

  return (
    <span className={cn("shrink-0 tabular-nums", className)}>
      {format.lufs(lufs)} <LoudnessUnit unit="LUFS" />
      {truePeakDb != null && (
        <span className={truePeakDb > 0 ? "text-warn" : undefined}>
          {" · "}
          {formatSignedDecimal(truePeakDb)} dB
          <LoudnessUnit unit="TP" compact />
        </span>
      )}
    </span>
  );
}
