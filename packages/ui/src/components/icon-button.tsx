import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

/**
 * Icon-only affordances: a transport button, the quieter utility button beside
 * it, and the oversized transport of a now-playing view. All are bare — no
 * fill, no border — so a row of them reads as a set of marks rather than a
 * toolbar, and all answer on colour alone.
 *
 * The `touch` size lifts a button to a 44px target where the layout has room
 * for it. Where it does not, the coarse-pointer halo in the base extends the
 * hit area past the mark without moving anything around it.
 */
const iconButtonVariants = cva(
  cn(
    "relative grid shrink-0 cursor-pointer place-items-center border-0 bg-transparent p-0",
    "rounded-sm motion-press outline-none active:scale-[0.98]",
    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
    "coarse:after:absolute coarse:after:-inset-2 coarse:after:content-['']",
    "disabled:pointer-events-none disabled:opacity-50"
  ),
  {
    variants: {
      variant: {
        /** Playback: ink at rest, artwork accent on hover. */
        play: "text-ink hover:text-art",
        /** Everything else beside it, a step quieter. */
        icon: "text-ink-soft hover:text-ink",
        /** The one transport of a now-playing view, already past 44px. */
        hero: "size-16 text-ink hover:text-art [&_svg]:size-9",
      },
      size: {
        default: "",
        touch: "",
      },
    },
    compoundVariants: [
      { variant: "play", size: "default", class: "size-8 [&_svg]:size-5.5" },
      { variant: "play", size: "touch", class: "size-11 [&_svg]:size-6" },
      { variant: "icon", size: "default", class: "size-7 [&_svg]:size-4" },
      { variant: "icon", size: "touch", class: "size-11 [&_svg]:size-5" },
    ],
    defaultVariants: { variant: "icon", size: "default" },
  }
);

export type IconButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof iconButtonVariants>;

export function IconButton({
  className,
  variant,
  size,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      data-slot="icon-button"
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { iconButtonVariants };
