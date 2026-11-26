import { Skeleton } from "@workspace/ui/components/skeleton";
import { PAGE, SCROLL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

const NAV_LINES = ["w-16", "w-24", "w-20", "w-16", "w-28"];

/** The hub while a section loads: its nav and a few setting rows, in place. */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-11 md:hidden" aria-hidden />
      <div
        className={cn(SCROLL, PAGE, "min-h-0 flex-1")}
        aria-busy
        aria-label="Loading settings"
      >
        <div className="grid grid-cols-[12rem_minmax(0,1fr)] items-start gap-x-12 phone:grid-cols-1">
          <div className="flex flex-col gap-6 pt-(--gutter) phone:gap-4">
            <Skeleton className="h-7 w-full" />
            <div className="flex flex-col gap-3 phone:hidden">
              {NAV_LINES.map((width, index) => (
                // eslint-disable-next-line @eslint-react/no-array-index-key -- placeholders with no identity
                <Skeleton key={index} className={cn("h-3", width)} />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-11 pt-(--gutter)">
            <Skeleton className="mt-3 h-10 w-48" />
            <div className="flex flex-col">
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="flex items-start justify-between gap-8 border-t border-rule px-2 py-4"
                >
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-full max-w-80" />
                  </div>
                  <Skeleton className="h-7 w-40" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
