import { cachedBrand } from "@/lib/brand";
import { logoImage } from "./logo-image";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  const brand = await cachedBrand();
  return logoImage(size.width, 0.8, brand);
}
