import type { SelectOption } from "@/fields/types";

/** `select` options for a test, each one's value its label. */
export function selectOptions(...labels: string[]): SelectOption[] {
  return labels.map((label) => ({ value: label, label }));
}
