import { sampleFileName } from "@workspace/ui/lib/sample-path";
import type { SampleDelta as SampleChange } from "@workspace/session-diff";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The samples a save added or dropped, as `+`/`−` lines of the file's own
 * name. Renders nothing when neither side changed.
 */
export function SampleDelta({ samples }: { samples: SampleChange }) {
  if (samples.added.length === 0 && samples.removed.length === 0) return null;

  return (
    <div>
      <div className={cn(LABEL, "mb-1.5 text-ink-soft")}>SAMPLES</div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-micro">
        {samples.added.map((path) => (
          <span key={`added:${path}`} className="text-art" title={path}>
            + {sampleFileName(path)}
          </span>
        ))}
        {samples.removed.map((path) => (
          <span
            key={`removed:${path}`}
            className="text-ink-faint line-through"
            title={path}
          >
            − {sampleFileName(path)}
          </span>
        ))}
      </div>
    </div>
  );
}
