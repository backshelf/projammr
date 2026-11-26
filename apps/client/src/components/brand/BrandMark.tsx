"use client";

import { useBrand } from "@/lib/brand-context";
import { imageUrl } from "@/lib/utils";
import { Logo } from "@workspace/ui/components/logo";

/** The instance's own logo, or the generated Projammr mark when none is set. */
export function BrandMark() {
  const brand = useBrand();
  const src = imageUrl(brand.logoImagePath, 64);

  if (!src) return <Logo />;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- an instance-provided image, not a local asset `next/image` can optimize at build time.
    <img src={src} alt="" className="size-[2em] rounded-md object-contain" />
  );
}
