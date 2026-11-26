"use server";

import { serverApi } from "@/lib/server-api";
import { myMachines } from "@/lib/shared-reads";
import type { ActionError, MachineList } from "@workspace/api/api";

/** The signed-in user's machines and shared "Not a bounce" files, for the Devices section's first render. */
export const getMyMachines = async (): Promise<MachineList | ActionError> =>
  myMachines(serverApi);
