"use client";

import { createContext, use } from "react";

export type RequestRowDelete = (ids: number[], label: string) => void;

/**
 * The table's delete confirmation, reachable from any cell a column renders
 * itself. `DataTable` provides it only when the table has a delete
 * handler, so a null value means "offer no delete".
 */
export const RowDeleteContext = createContext<RequestRowDelete | null>(null);

export function useRequestRowDelete() {
  return use(RowDeleteContext);
}
