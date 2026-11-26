import {
  isActionError,
  isNotFound,
  type ActionError,
} from "@workspace/api/lib/action-result";
import { notFound } from "next/navigation";

/**
 * Unwraps a critical read. A missing or forbidden row renders the segment's
 * not-found state; any other failure throws to its error boundary, which can
 * retry. Neither call returns.
 */
export function loaded<T>(result: T | ActionError): T {
  if (!isActionError(result)) return result;
  if (isNotFound(result)) notFound();
  throw new Error(result.error);
}
