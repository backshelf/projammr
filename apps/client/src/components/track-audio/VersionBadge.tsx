import { cn } from "@workspace/ui/lib/utils";

export function VersionBadge({
  version,
  active,
  className,
}: {
  version?: number | null;
  /** Solid accent fill, for where the badge names the version in focus. */
  active?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-sm border border-rule-strong px-1",
        "font-mono text-micro/none text-ink-soft",
        active && "border-transparent bg-art text-paper",
        className
      )}
    >
      {version == null ? "—" : `v${version}`}
    </span>
  );
}
