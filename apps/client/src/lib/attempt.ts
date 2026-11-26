import "server-only";
import type { ActionError } from "@workspace/api/lib/action-result";
import { unstable_rethrow } from "next/navigation";

/** Runs a read that may reject (an unreachable API), turning the rejection into an `ActionError`. */
export async function attempt<T>(
  read: () => Promise<T | ActionError>
): Promise<T | ActionError> {
  try {
    return await read();
  } catch (error) {
    unstable_rethrow(error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
