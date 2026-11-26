import type { ComponentType, ReactNode } from "react";

type LinkProps = {
  href: string;
  className?: string;
  children?: ReactNode;
};

/** What a component links out through: the app's own router link, or a plain
 *  anchor where there is no router to hand one over (a static page). */
export type LinkComponent = ComponentType<LinkProps>;

/** The fallback `LinkComponent`: a plain `<a>`. */
export function Anchor({ children, ...props }: LinkProps) {
  return <a {...props}>{children}</a>;
}
