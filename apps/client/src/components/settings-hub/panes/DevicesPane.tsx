import { getMyMachines } from "@/actions/machines";
import { isActionError } from "@workspace/api/lib/action-result";
import { MachinesSection } from "../devices/MachinesSection";
import type { HubPane } from "./types";

/**
 * The Devices section's machines: the caller's list read here for the first
 * render, then kept current in the browser. A list that cannot be read shows
 * as such rather than failing the page.
 */
async function Machines() {
  const list = await getMyMachines();
  return <MachinesSection initial={isActionError(list) ? null : list} />;
}

/** The caller's machines: each one's facts, what it has pushed and its "Never here" folders, and the files shared as "Not a bounce". */
export const DevicesPane: HubPane = {
  id: "devices",
  section: "devices",
  label: "Machines",
  order: 100,
  Content: Machines,
};
