import {
  SectionCount,
  sectionTitle,
  type SectionProminence,
} from "@workspace/ui/components/layout/section-head";
import { SECTION_HEAD } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { PropsWithChildren, ReactNode } from "react";

/** A section head that folds. Same title treatment as {@link SectionHead},
 *  behind a chevron. */
export const CollapsibleSection = ({
  children,
  label,
  count,
  action,
  prominence,
  defaultOpen = true,
  keepMounted = false,
}: PropsWithChildren<{
  label: string;
  count?: ReactNode;
  action?: ReactNode;
  prominence?: SectionProminence;
  defaultOpen?: boolean;
  /** Hides the content while folded instead of unmounting it — for children
   *  that hold state a remount would lose, an editor's document being one. */
  keepMounted?: boolean;
}>) => (
  <Collapsible defaultOpen={defaultOpen} className={"group/section"}>
    {/* Folded, the head has nothing below it to bind to, so it gives up the
        margin and the section is one line in the page's rhythm. */}
    <div className={cn(SECTION_HEAD, "group-data-closed/section:mb-0")}>
      <h2 className={sectionTitle(prominence)}>
        <CollapsibleTrigger
          className={cn(
            sectionTitle(prominence),
            "flex min-h-11 items-center gap-1.5 text-left md:min-h-0"
          )}
        >
          <CollapsibleChevron />
          <span>
            {label}
            {count != null && <SectionCount>{count}</SectionCount>}
          </span>
        </CollapsibleTrigger>
      </h2>
      {action}
    </div>
    <CollapsibleContent keepMounted={keepMounted}>
      {children}
    </CollapsibleContent>
  </Collapsible>
);
