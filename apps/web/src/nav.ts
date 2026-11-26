import { SITE } from "@/site";

export type NavLink = { label: string; href: string; external?: boolean };

/** The header's links, on marketing pages and in the docs alike. */
export const PRIMARY_NAV: NavLink[] = [
  { label: "Features", href: "/#features" },
  { label: "dit", href: "/dit/" },
  { label: "Docs", href: "/docs/" },
  { label: "Pricing", href: "/pricing/" },
];

/** The footer's link groups. */
export const FOOTER_NAV: { heading: string; links: NavLink[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "dit, the Mac app", href: "/dit/" },
      { label: "Listening and review", href: "/features/listening/" },
      { label: "Notebook and lyrics", href: "/features/writing/" },
      { label: "Collaboration", href: "/features/collaboration/" },
      { label: "Pricing", href: "/pricing/" },
    ],
  },
  {
    heading: "Docs",
    links: [
      { label: "Using Projammr", href: "/docs/guide/" },
      { label: "API", href: "/docs/api/" },
      { label: "Self-hosting", href: "/docs/self-hosting/" },
      { label: "Contributing", href: "/docs/contributing/" },
    ],
  },
  {
    heading: "Project",
    links: [
      { label: "Source on GitHub", href: SITE.repository, external: true },
      { label: "How AI is used", href: "/ai/" },
    ],
  },
];
