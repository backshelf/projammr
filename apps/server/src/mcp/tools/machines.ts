import { z } from "zod";
import { listMachineSummaries } from "../../db/queries/machines.js";
import {
  openSessionSchema,
  pushedRepoSchema,
} from "../../db/schema/machines.js";
import { requireProject } from "../authorize.js";
import { defineTool } from "../spec.js";

const machineSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: z.string(),
  appVersion: z.string(),
  lastSeenAt: z.date(),
  online: z.boolean(),
  openSession: openSessionSchema.nullable(),
  pushedRepos: z.array(pushedRepoSchema),
});

const listMachinesTool = defineTool({
  name: "list_machines",
  title: "List your machines",
  description:
    "The caller's dit machines, most recently seen first, each with its dit app version, whether it is online (a beat within 90 s), the session it has open and the repos it has pushed to (those of projects the caller is a member of). Pass `projectId` to keep only the machines tracking a repo of that project. An offline machine reports no open session.",
  scope: "read",
  idempotent: true,
  input: z.object({ projectId: z.number().int().optional() }),
  output: z.object({ machines: z.array(machineSummarySchema) }),
  run: async (actor, { projectId }) => {
    if (projectId !== undefined) {
      await requireProject(actor, projectId, "viewer");
    }
    return { machines: await listMachineSummaries(actor.id, projectId) };
  },
});

export const MACHINE_TOOLS = [listMachinesTool];
