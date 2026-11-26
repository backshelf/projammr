import type { ComponentProps, JSX } from "react";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";

/**
 * The shared text field at the panel's body size. The panel is always narrower than the phone tier, where the
 * field's own size steps up to the lead size; the panel reads at `text-small` throughout.
 */
export function PanelInput({
  className,
  ...props
}: ComponentProps<typeof Input>): JSX.Element {
  return <Input className={cn("text-small", className)} {...props} />;
}
