import { cn } from "@workspace/ui/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("shimmer-surface rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
