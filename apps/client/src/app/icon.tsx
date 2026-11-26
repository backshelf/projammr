import { cachedBrand } from "@/lib/brand";
import { ICONS, type IconId } from "./icon-ids";
import { logoImage } from "./logo-image";

export const contentType = "image/png";

export function generateImageMetadata() {
  return ICONS.map(({ id, size }) => ({
    id,
    size: { width: size, height: size },
    contentType,
  }));
}

export default async function Icon({ id }: { id: Promise<IconId> }) {
  const [iconId, brand] = await Promise.all([id, cachedBrand()]);
  const icon = ICONS.find((entry) => entry.id === iconId) ?? ICONS[0];
  // The icon derives from the logo when there is no icon of its own; neither
  // set, the generated drawing.
  return logoImage(icon.size, icon.purpose === "maskable" ? 0.6 : 0.8, brand);
}
