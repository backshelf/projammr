import type { ProjectStorage } from "@workspace/api/api";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { Meter } from "@workspace/ui/components/table";
import type { Formatters } from "@workspace/ui/lib/formatters";

/**
 * What the project's files are taking, read as a piece of studio gear: the
 * figure, and — only where the instance caps a project — the meter it fills.
 * An uncapped instance has nothing to fill, so it gets the figure alone rather
 * than a bar that could never move. The part of it the project's repositories
 * take reads beside it, and is left out while they take nothing. Sizes are written in the viewer's
 * `format`.
 */
export function SettingsStorage({
  storage,
  format,
}: {
  storage: ProjectStorage;
  format: Formatters;
}) {
  const { usedBytes, limitBytes, repositoryBytes } = storage;
  const used = format.bytes(usedBytes, 1);

  return (
    <section>
      <SectionHead
        action={
          <span className="text-small text-ink-soft tabular-nums">
            {limitBytes == null
              ? `${used} used`
              : `${used} of ${format.bytes(limitBytes, 0)}`}
          </span>
        }
      >
        STORAGE
      </SectionHead>
      {limitBytes != null && (
        <Meter
          value={limitBytes === 0 ? 100 : (usedBytes / limitBytes) * 100}
          className="mt-1"
          title={`${used} of ${format.bytes(limitBytes, 0)} used`}
        />
      )}
      {repositoryBytes > 0 && (
        <p className="mt-1 text-small text-ink-soft tabular-nums">
          Repositories {format.bytes(repositoryBytes, 1)}
        </p>
      )}
    </section>
  );
}
