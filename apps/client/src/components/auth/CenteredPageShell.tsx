import { cn } from "@workspace/ui/lib/utils";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * The centred, sidebar-less page shown before the app proper: the sign-in
 * screen, a bare token (an invite, a share link), and anything else that has
 * to say its piece without a sidebar. A title, a line of body copy, and
 * whatever the flow needs underneath.
 */
export function CenteredPageShell({
  title,
  body,
  children,
  wide,
  inShell,
}: {
  title: string;
  /** Omitted for a state, such as an error boundary, whose copy has no body line. */
  body?: string;
  children?: React.ReactNode;
  /** Wider content column, for a share page's track list and player. */
  wide?: boolean;
  /** Sits inside a page area that already has its own shell (a project's), so it drops the logo and the sunk background. */
  inShell?: boolean;
}) {
  return (
    <div
      className={cn(
        // The four paddings are written out rather than an override on
        // `p-(--gutter)`: tailwind-merge drops a `pt-` that a later `p-`
        // covers, and the status bar is drawn over this page.
        "grid h-full min-h-full place-items-center overflow-y-auto pt-[calc(var(--gutter)+env(safe-area-inset-top))] pr-(--gutter) pb-(--gutter) pl-(--gutter)",
        !inShell && "bg-paper-sunk"
      )}
    >
      <div
        className={cn(
          "flex w-full flex-col items-center gap-6 text-center",
          wide ? "max-w-2xl" : "max-w-sm"
        )}
      >
        {!inShell && <BrandMark />}
        <div>
          <h1 className={"font-heading text-subtitle/[1.1] text-ink"}>
            {title}
          </h1>
          {body && (
            <p className={cn("max-w-[34ch] text-body text-ink-soft", "mt-2")}>
              {body}
            </p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
