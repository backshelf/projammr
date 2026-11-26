/** The plans the pricing page and the landing page's summary both read. Hosting
 * does not exist yet: every hosted price and limit below is a placeholder,
 * listed as one in the pull request, and every hosted action reads "Coming
 * soon" rather than linking anywhere. The self-hosted plan is the app as it
 * ships today; its storage line names the two storage caps an instance admin
 * can set (Settings → Instance → Limits, which `MAX_PROJECT_GB` and
 * `MAX_USER_GB` can seed), which are off until set. */

export type Plan = {
  id: "self-hosted" | "solo" | "studio";
  name: string;
  /** Whole currency units a month; `0` is free. */
  monthly: number;
  /** Who runs the server. */
  host: string;
  storage: string;
  members: string;
  /** Where the plan's action goes. `null` renders the "Coming soon" mark. */
  href: string | null;
  action: string;
};

/** The currency the placeholder prices are written in. */
export const PRICE_CURRENCY = "USD";

export const PLANS: Plan[] = [
  {
    id: "self-hosted",
    name: "Self-hosted",
    monthly: 0,
    host: "Your server",
    storage: "Your disk, with no cap unless you set one",
    members: "No limit",
    href: "/docs/self-hosting/quickstart/",
    action: "Self-host it",
  },
  {
    id: "solo",
    name: "Hosted Solo",
    monthly: 5,
    host: "Hosted for you",
    storage: "50 GB",
    members: "Up to 3 members",
    href: null,
    action: "Hosted Solo",
  },
  {
    id: "studio",
    name: "Hosted Studio",
    monthly: 12,
    host: "Hosted for you",
    storage: "250 GB",
    members: "Up to 10 members",
    href: null,
    action: "Hosted Studio",
  },
];

/** A plan's price as the page prints it: "Free", or the amount a month. */
export const formatPrice = (plan: Plan): string =>
  plan.monthly === 0
    ? "Free"
    : new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: PRICE_CURRENCY,
        currencyDisplay: "narrowSymbol",
        maximumFractionDigits: 0,
      }).format(plan.monthly);
