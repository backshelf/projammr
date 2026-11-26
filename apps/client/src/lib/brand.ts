import "server-only";
import { attempt } from "@/lib/attempt";
import { cachedInstance } from "@/lib/server-data";
import { isActionError } from "@workspace/api/lib/action-result";
import { cache } from "react";
import { DEFAULT_BRAND, type Brand } from "./brand-defaults";

export type { Brand } from "./brand-defaults";

/**
 * This instance's brand: `GET /api/instance`'s `brand`, which is public and
 * works signed out, or the registry defaults when the read fails. There is no
 * second fetch path — `cachedInstance()` is the one request-scoped read every
 * caller on the page shares.
 */
export const cachedBrand = cache(async (): Promise<Brand> => {
  const instance = await attempt(cachedInstance);
  return isActionError(instance) ? DEFAULT_BRAND : instance.brand;
});
