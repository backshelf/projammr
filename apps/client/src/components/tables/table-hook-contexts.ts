"use client";

import { createTableHookContexts } from "@tanstack/react-table";
import type { dataTableFeatures } from "@workspace/ui/lib/table-config";

/**
 * The data table's table, cell and header contexts, scoped to it rather than
 * shared with every other `createTableHook` in the app. The hooks here know the
 * features but not the factory, so a module the factory imports can read a
 * cell or a header without importing the factory back.
 */
export const { tableContext, cellContext, headerContext, useCellContext } =
  createTableHookContexts<typeof dataTableFeatures>();
