import type { AdminStorage, StorageReport } from "@workspace/api/api";
import { pluralizeCount } from "@workspace/session-diff/format";
import type { Formatters } from "@workspace/ui/lib/formatters";
import {
  Row,
  RowMain,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { Meter } from "@workspace/ui/components/table";

/** Instance-wide storage: the total, then what each project and each
 *  account is using. Uncapped scopes show the figure alone — a meter that
 *  could never move is noise, as `SettingsStorage` already treats it. Sizes
 *  are written in the viewer's `format`. */
export function AdminStorageSection({
  storage,
  format,
}: {
  storage: AdminStorage;
  format: Formatters;
}) {
  return (
    <div className="flex flex-col gap-8">
      <SectionHead
        action={
          <span className="text-small text-ink-soft tabular-nums">
            {format.bytes(storage.usedBytes, 1)} used
          </span>
        }
      >
        TOTAL
      </SectionHead>
      {storage.sharing.savedBytes > 0 && (
        <p className="-mt-6 text-small text-ink-soft tabular-nums">
          {sharingLine(storage.sharing, format)}
        </p>
      )}

      <section>
        <SectionHead count={storage.projects.length}>PROJECTS</SectionHead>
        <StorageRows
          scopes={storage.projects}
          empty="No projects yet."
          format={format}
        />
      </section>

      <section>
        <SectionHead count={storage.users.length}>ACCOUNTS</SectionHead>
        <StorageRows
          scopes={storage.users}
          empty="No accounts yet."
          format={format}
        />
      </section>
    </div>
  );
}

/** "Samples stored once · shared by 3 projects · 1.2 GB saved". */
export function sharingLine(
  sharing: AdminStorage["sharing"],
  format: Pick<Formatters, "bytes">
): string {
  const projects = pluralizeCount(sharing.projects, "project");
  return `Samples stored once · shared by ${projects} · ${format.bytes(sharing.savedBytes, 1)} saved`;
}

function StorageRows({
  scopes,
  empty,
  format,
}: {
  scopes: (Omit<StorageReport, "repositoryBytes"> & {
    repositoryBytes?: number;
  })[];
  empty: string;
  format: Formatters;
}) {
  if (scopes.length === 0) {
    return <p className="text-small text-ink-soft italic">{empty}</p>;
  }

  return (
    <Rows>
      {scopes.map((scope) => {
        const used = format.bytes(scope.usedBytes, 1);
        return (
          <Row key={scope.scopeId}>
            <RowMain>
              <RowTitle>{scope.name ?? scope.scopeId}</RowTitle>
              {scope.repositoryBytes != null && scope.repositoryBytes > 0 && (
                <span className="text-small text-ink-soft tabular-nums">
                  Repositories {format.bytes(scope.repositoryBytes, 1)}
                </span>
              )}
              {scope.limitBytes != null && (
                <Meter
                  value={
                    scope.limitBytes === 0
                      ? 100
                      : (scope.usedBytes / scope.limitBytes) * 100
                  }
                  className="mt-1 max-w-40"
                  title={`${used} of ${format.bytes(scope.limitBytes, 0)} used`}
                />
              )}
            </RowMain>
            <span className="shrink-0 text-small text-ink-soft tabular-nums">
              {scope.limitBytes == null
                ? used
                : `${used} of ${format.bytes(scope.limitBytes, 0)}`}
            </span>
          </Row>
        );
      })}
    </Rows>
  );
}
