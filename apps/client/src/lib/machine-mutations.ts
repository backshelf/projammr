"use client";

import { browserApi } from "@/lib/browser-api";
import { defineMutation } from "@/lib/mutation";
import { toActionOutcome } from "@workspace/api/lib/action-result";

/*
 * The browser's changes to the caller's machines and the rejections they
 * keep. Each invalidates `machines`, the list the Machines section holds,
 * which reads the server again rather than guessing what the change did.
 */

/**
 * Removes a machine: the hub signs it out of dit and drops its "Never here"
 * folders, and keeps every save and commit that names it.
 */
export const removeMachine = (machineId: string) =>
  defineMutation(async () => {
    const res = await browserApi.DELETE("/api/machines/{id}", {
      params: { path: { id: machineId } },
    });

    return toActionOutcome(res, "Couldn't remove the machine", {
      removed: machineId,
    });
  }, ["machines"]);

/** Takes back one "Not a bounce" file or "Never here" folder; the dit app hears of it on its next refresh. */
export const forgetRejection = (rejectionId: number) =>
  defineMutation(async () => {
    const res = await browserApi.DELETE("/api/machines/rejections/{id}", {
      params: { path: { id: String(rejectionId) } },
    });

    return toActionOutcome(res, "Couldn't take that back", {
      removed: rejectionId,
    });
  }, ["machines"]);
