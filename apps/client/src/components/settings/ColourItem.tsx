"use client";

import { getContrastColour } from "@/lib/css-utils";
import { IconPencil } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { RowMain } from "@workspace/ui/components/layout/rows";
import { StatusPill } from "@workspace/ui/components/status-chip";
import { REVEAL_ON_HOVER } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useState, type ComponentProps, type ReactNode } from "react";

/** An icon button on a row filled with a user's colour. It takes the row's
 *  ink instead of the theme's, and shows its hover and focus in that ink too:
 *  the theme's muted wash is a guess against a colour nobody chose in advance. */
export function ColourRowAction({
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={cn(
        "text-current hover:bg-transparent hover:text-current dark:hover:bg-transparent",
        "focus-visible:border-current focus-visible:ring-current/60",
        REVEAL_ON_HOVER,
        className
      )}
      {...props}
    />
  );
}

/**
 * One row of a colour list (a status, a label): the colour is the row's
 * background, and its ink is chosen against that colour rather than the theme.
 * A `percentage` draws the status pie; without one the row is a flag.
 */
function ColourRow({
  colour,
  ink,
  percentage,
  leading,
  title,
  meta,
  trailing,
  children,
}: {
  colour: string;
  /** The row's text colour; by default whichever contrasts with `colour`. */
  ink?: string;
  percentage?: number;
  /** A control ahead of the title, e.g. a drag handle. */
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <StatusPill
      block
      flag={percentage === undefined}
      colour={colour}
      percentage={percentage}
      ink={ink ?? getContrastColour(colour)}
      className="group min-h-11 gap-2.5 py-1"
    >
      {leading}
      <RowMain className="flex min-w-0 items-baseline gap-3">
        <span className="shrink-0 font-medium">{title}</span>
        {meta && <span className="min-w-0 truncate text-micro">{meta}</span>}
      </RowMain>
      {children}
      {trailing != null && (
        <span className="w-10 shrink-0 text-right text-micro tabular-nums">
          {trailing}
        </span>
      )}
    </StatusPill>
  );
}

/**
 * The swap between a list item's row and the one-line form that edits it.
 * Closing the form unmounts the field that held focus, so the control that
 * opened it takes focus back when it remounts: spread `opener` onto it.
 */
export function useRowEditor() {
  const [editing, setEditing] = useState(false);
  const [refocusOpener, setRefocusOpener] = useState(false);

  return {
    editing,
    close: () => {
      setRefocusOpener(true);
      setEditing(false);
    },
    opener: {
      autoFocus: refocusOpener,
      onClick: () => {
        setRefocusOpener(false);
        setEditing(true);
      },
    },
  };
}

/**
 * A list item that swaps between its row and the one-line form that edits it.
 * The pencil is the editor's way in; `remove` is the delete control the pane
 * owns, since what deleting asks differs between panes.
 */
export function ColourItem({
  name,
  colour,
  ink,
  percentage,
  leading,
  title,
  meta,
  trailing,
  canEdit,
  actions,
  remove,
  renderForm,
  liProps,
}: {
  /** The item's name, for the controls' accessible names. */
  name: string;
  colour: string;
  /** The row's text colour, for a fill `getContrastColour` cannot read (a token). */
  ink?: string;
  percentage?: number;
  /** A control ahead of the title, e.g. a drag handle. */
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  canEdit: boolean;
  /** Controls shown before the pencil, e.g. reorder buttons. */
  actions?: ReactNode;
  remove?: ReactNode;
  renderForm: (close: () => void) => ReactNode;
  /** Spread onto the outer `<li>`, for a sortable row's ref and transform. */
  liProps?: ComponentProps<"li">;
}) {
  const editor = useRowEditor();

  if (editor.editing) return <li {...liProps}>{renderForm(editor.close)}</li>;

  return (
    <li {...liProps}>
      <ColourRow
        colour={colour}
        ink={ink}
        percentage={percentage}
        leading={leading}
        title={title}
        meta={meta}
        trailing={trailing}
      >
        {canEdit && (
          <>
            {actions}
            <ColourRowAction {...editor.opener} aria-label={`Edit ${name}`}>
              <IconPencil size={16} />
            </ColourRowAction>
            {/* Holds the bin's place so the pencils line up down the list. */}
            {remove || <span aria-hidden className="size-6 shrink-0" />}
          </>
        )}
      </ColourRow>
    </li>
  );
}
