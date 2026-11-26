"use client";

import { useMutate } from "@/hooks/use-mutate";
import { toastActionResult } from "@/lib/action-toast";
import type { Mutation } from "@/lib/mutation";
import {
  isActionError,
  type ActionError,
} from "@workspace/api/lib/action-result";
import { useCallback } from "react";

/**
 * Runs a machine mutation and says how it went. A request that never reached
 * the server reads as a refusal rather than a thrown error. Resolves to
 * whether the change landed.
 */
export function useMachineMutation() {
  const mutate = useMutate();
  return useCallback(
    async <T>(
      mutation: Mutation<T | ActionError>,
      success: string
    ): Promise<boolean> => {
      const result = await mutate(mutation).catch(
        (error: unknown): ActionError => ({
          error: error instanceof Error ? error.message : "Network error",
        })
      );
      toastActionResult(
        isActionError(result)
          ? { ok: false, message: result.error }
          : { ok: true, message: success }
      );
      return !isActionError(result);
    },
    [mutate]
  );
}
