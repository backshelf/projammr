import { PageLinks } from "@/components/tables/PageLinks";
import type { InstanceMachinesPage } from "@workspace/api/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from "@workspace/ui/components/table";
import type { Formatters } from "@workspace/ui/lib/formatters";

/**
 * One page of every account's dit machines, most recently seen first: whose
 * each is, its platform, dit version and last beat. Read-only; an admin who
 * needs a machine gone asks its owner, whose Devices settings carry Remove.
 */
export function AdminMachinesTable({
  data,
  page,
  pageSize,
  format,
}: {
  data: InstanceMachinesPage;
  page: number;
  pageSize: number;
  format: Pick<Formatters, "relative">;
}) {
  const { items, total } = data;

  if (total === 0) {
    return (
      <p className="text-small text-ink-soft">
        No machine has signed in to dit on this instance yet.
      </p>
    );
  }

  return (
    <>
      <TableScroll>
        <Table variant="entity">
          <TableHeader>
            <TableRow>
              <TableHead>Owner</TableHead>
              <TableHead>Machine</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Last seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((machine) => (
              <TableRow key={machine.id}>
                <TableCell>{machine.owner.name}</TableCell>
                <TableCell>{machine.name}</TableCell>
                <TableCell>{machine.platform}</TableCell>
                <TableCell>{machine.appVersion}</TableCell>
                <TableCell>{format.relative(machine.lastSeenAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>

      <PageLinks page={page} pageSize={pageSize} rowCount={total} />
    </>
  );
}
