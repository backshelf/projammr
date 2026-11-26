"use client";

import { createContext, use, type ReactNode } from "react";
import { DEFAULT_BRAND, type Brand } from "./brand-defaults";

export type { Brand } from "./brand-defaults";

const BrandContext = createContext<Brand>(DEFAULT_BRAND);

/**
 * Holds the instance's brand for every client component below it, seeded
 * from `cachedBrand()`. Mounted once, in the root layout, so it reaches every
 * page and every `error.tsx` — a server component that needs the brand reads
 * `cachedBrand()` directly instead.
 */
export function BrandProvider({
  brand,
  children,
}: {
  brand: Brand;
  children: ReactNode;
}) {
  return <BrandContext value={brand}>{children}</BrandContext>;
}

/** This instance's name, mark and colours. */
export function useBrand(): Brand {
  return use(BrandContext);
}
