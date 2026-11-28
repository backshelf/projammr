import { Skeleton } from "@workspace/ui/components/skeleton";
import { PAGE, SCROLL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";

const OPEN_NAV_ITEMS = ["w-20", "w-24", "w-16", "w-28", "w-20"];
const OTHER_NAV_SECTIONS = ["w-16", "w-20", "w-14"];
const ROWS = [
  { label: "w-32", description: "max-w-80", control: "w-44" },
  { label: "w-40", description: "max-w-72", control: "w-10" },
  { label: "w-28", description: "max-w-96", control: "w-48" },
  { label: "w-36", description: "max-w-64", control: "w-36" },
];

/** The hub while a section loads: its nav and a few setting rows, in place. */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-11 md:hidden" aria-hidden />
      <div
        className={cn(SCROLL, PAGE, "min-h-0 flex-1 [&>*]:max-w-[68rem]")}
        aria-busy
        aria-label="Loading settings"
      >
        <div className="mx-auto grid w-full max-w-[68rem] grid-cols-[12rem_minmax(0,1fr)] items-start gap-x-12 phone:grid-cols-1">
          <div className="flex flex-col gap-6 pt-(--gutter) phone:gap-4">
            <Skeleton className="h-7 w-full" />
            <div className="flex flex-col gap-5 phone:hidden">
              <div className="flex flex-col">
                <Skeleton className="my-1 h-3 w-16" />
                <div className="mt-2 flex flex-col gap-2.5 border-l border-rule py-1 pl-3">
                  {OPEN_NAV_ITEMS.map((width, index) => (
                    // eslint-disable-next-line @eslint-react/no-array-index-key -- placeholders with no identity
                    <Skeleton key={index} className={cn("h-3.5", width)} />
                  ))}
                </div>
              </div>
              {OTHER_NAV_SECTIONS.map((width, index) => (
                // eslint-disable-next-line @eslint-react/no-array-index-key -- placeholders with no identity
                <Skeleton key={index} className={cn("my-1 h-3", width)} />
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-11 pb-11">
            <div className="flex flex-col pt-(--gutter)">
              <Skeleton className="mt-3 h-9 w-48" />
              <Skeleton className="mt-2.5 h-4 w-full max-w-96" />
            </div>
            <div className="flex flex-col">
              <Skeleton className="mb-3.5 h-3.5 w-24" />
              <div className="flex flex-col">
                {ROWS.map((row, index) => (
                  <div
                    // eslint-disable-next-line @eslint-react/no-array-index-key -- placeholders with no identity
                    key={index}
                    className="flex items-start justify-between gap-8 border-t border-rule px-2 py-4"
                  >
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className={cn("h-3.5", row.label)} />
                      <Skeleton className={cn("h-3 w-full", row.description)} />
                      <Skeleton className="mt-1 h-2.5 w-14" />
                    </div>
                    <Skeleton className={cn("h-7 shrink-0", row.control)} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
