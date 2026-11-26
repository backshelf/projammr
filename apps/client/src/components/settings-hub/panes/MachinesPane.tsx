import { getAdminMachines } from "@/actions/admin";
import { AdminMachinesTable } from "@/components/admin/AdminMachinesTable";
import { cachedFormatters } from "@/lib/formatters";
import { parsePageParam } from "@/lib/table-params";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane, HubPaneProps } from "./types";

const MACHINES_PAGE_SIZE = 20;

async function Machines({ searchParams }: HubPaneProps) {
  const page = parsePageParam(searchParams);
  const [machines, format] = await Promise.all([
    getAdminMachines(page, MACHINES_PAGE_SIZE),
    cachedFormatters(),
  ]);
  if (isActionError(machines)) {
    return <p className="text-small text-ink-soft">{machines.error}</p>;
  }
  return (
    <AdminMachinesTable
      data={machines}
      page={page}
      pageSize={MACHINES_PAGE_SIZE}
      format={format}
    />
  );
}

/** Every account's dit machines: whose each is, its platform and version, and when it last reported in. */
export const MachinesPane: HubPane = {
  id: "machines",
  section: "instance",
  label: "Machines",
  order: 25,
  Content: Machines,
};
