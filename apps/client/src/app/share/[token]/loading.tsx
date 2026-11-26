import { Skeleton } from "@workspace/ui/components/skeleton";

/** The first viewport of a share while the read is in flight: what was shared,
 *  then the play control beside the waveform. */
export default function ShareLoading() {
  return (
    <div
      aria-hidden
      className="flex min-h-dvh flex-col justify-center gap-8 bg-paper-sunk p-(--gutter)"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-3/4" />
      </div>
      <div className="mx-auto flex w-full max-w-2xl items-center gap-4">
        <Skeleton className="size-14 shrink-0 rounded-full" />
        <Skeleton className="h-20 flex-1" />
      </div>
    </div>
  );
}
