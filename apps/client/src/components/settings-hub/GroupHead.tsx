import { SectionHead } from "@workspace/ui/components/layout/section-head";
import type { ReactNode } from "react";

/** What a block on a hub page is for, under its head. */
export function GroupDescription({ children }: { children?: string }) {
  return children ? (
    <p className="-mt-1.5 mb-4 max-w-[54ch] text-small text-pretty text-ink-soft">
      {children}
    </p>
  ) : null;
}

/** The head of a block on a hub page: its label, an action on the same line, and what it is for under them. */
export function GroupHead({
  label,
  description,
  action,
  as,
}: {
  label: string;
  description?: string;
  action?: ReactNode;
  as?: "h2" | "h3" | "h4";
}) {
  return (
    <>
      <SectionHead action={action} as={as}>
        {label}
      </SectionHead>
      <GroupDescription>{description}</GroupDescription>
    </>
  );
}
