import { type PageSection, shownSections } from "@/lib/policies/shell";
import { Fragment, type ReactNode } from "react";

/**
 * A page's sections in the order its section list gives, those the list hides
 * left out. The page hands every section it has, by id; the list (the shell
 * policy's, for that page) decides which show and where.
 */
export function PageSections<Id extends string>({
  order,
  sections,
}: {
  order: readonly PageSection<Id>[];
  sections: Record<Id, ReactNode>;
}) {
  return shownSections(order).map(({ id }) => (
    <Fragment key={id}>{sections[id]}</Fragment>
  ));
}
