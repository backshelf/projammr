"use client";

import { patchField } from "@/actions/patch-field";
import { Loading } from "@workspace/ui/components/layout/loading";
import {
  StatusDisplay,
  StatusDisplayProps,
  StatusDisplayType,
} from "@/components/status/StatusDisplay";
import { StatusMenuList } from "@/components/status/components/StatusMenu";
import { ENTITIES, StatusKind } from "@/entities";
import { ActionError } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { PropsWithChildren, use, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

export type StatusDropdownProps = PropsWithChildren<{
  statuses: Promise<StatusDisplayType[] | ActionError>;
  targetId: number;
  targetKind: StatusKind;
  className?: string;
  /**
   * The status as the server last reported it. Passing this lets the trigger
   * show the picked status the moment it is picked, instead of waiting for
   * the round trip; without it the trigger renders `children` unchanged.
   */
  current?: StatusDisplayType;
  /** How the trigger renders `current`. Ignored when `children` is used. */
  variant?: StatusDisplayProps["variant"];
}>;

export const StatusDropdown = (props: StatusDropdownProps) => {
  const {
    statuses,
    targetId,
    targetKind,
    children,
    className,
    current,
    variant = "icon-title",
  } = props;

  // `shown` is the picked status while a save is in flight and the server's
  // own value the rest of the time, so the pill starts moving to its new
  // colour on click rather than after the round trip.
  const [, startTransition] = useTransition();
  const [shown, showOptimistic] = useOptimistic(current);

  const update = (picked: StatusDisplayType) => {
    // Everything stays inside the transition: the optimistic value lives
    // exactly as long as the transition is pending. `patchField` refreshes the
    // route itself on success, so that refresh lands inside the same
    // transition and the picked status holds until the server's own version
    // of it arrives rather than flicking back to the old one in between. A
    // failure ends the transition without a refresh, which reverts the pill
    // on its own.
    startTransition(async () => {
      showOptimistic(picked);

      const result = await patchField(
        targetKind,
        targetId,
        "statusId",
        picked.id
      );

      if (isActionError(result)) {
        toast.error(
          `Failed to update ${ENTITIES[targetKind].nouns.singular} status.`
        );
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn("cursor-pointer text-left", className)}
      >
        {shown ? (
          <StatusDisplay status={shown} variant={variant} />
        ) : (
          (children ?? <span className={"text-ink-faint"}>Set status</span>)
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="overflow-visible p-0">
        <Loading>
          <ResolvedStatusMenu
            statuses={statuses}
            onPick={update}
            currentId={shown?.id}
          />
        </Loading>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Suspends on the statuses promise so the menu can be opened before they
 *  arrive. */
const ResolvedStatusMenu = (props: {
  statuses: StatusDropdownProps["statuses"];
  onPick: (status: StatusDisplayType) => void;
  currentId?: number;
}) => {
  const statuses = use(props.statuses);
  if (isActionError(statuses)) return null;

  return (
    <StatusMenuList
      statuses={statuses}
      currentId={props.currentId}
      onPick={props.onPick}
    />
  );
};
