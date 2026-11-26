import type { JSX, ReactNode } from "react";
import { Row } from "@workspace/ui/components/layout/rows";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

import { ErrorLine } from "../error-line";

/**
 * One setting as a hairline row: its label and what it does on the left, a compact control on the right, and under
 * the description one facts line in the label shape (what is true of it now, in words). A wide control goes in
 * `children`, under the row's text. The row names itself with `id` and shows why a change was refused under it.
 *
 * `labelFor` makes the label a real label of the control with that id. Leave it off for a control that carries its
 * own words (a button), whose name a label would replace.
 */
export function SettingRow({
  id,
  label,
  labelFor,
  description,
  facts,
  control,
  error,
  children,
}: {
  id: string;
  label: string;
  labelFor?: string;
  description?: ReactNode;
  facts?: ReactNode;
  control?: ReactNode;
  error?: string | null;
  children?: ReactNode;
}): JSX.Element {
  return (
    <Row className="flex-col items-stretch gap-2 px-0 hover:bg-transparent">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {labelFor === undefined ? (
            <span id={`${id}-label`} className="text-body text-ink">
              {label}
            </span>
          ) : (
            <label
              id={`${id}-label`}
              htmlFor={labelFor}
              className="text-body text-ink"
            >
              {label}
            </label>
          )}
          {description && (
            <p
              id={`${id}-description`}
              className="text-micro text-pretty text-ink-soft"
            >
              {description}
            </p>
          )}
          {facts && <p className={cn(LABEL, "text-ink-faint")}>{facts}</p>}
        </div>
        {control && <div className="shrink-0">{control}</div>}
      </div>
      {children}
      <ErrorLine error={error ?? null} id={`${id}-error`} />
    </Row>
  );
}
