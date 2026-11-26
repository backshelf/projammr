import { getSharelink } from "@/actions/sharelinks";
import { cache } from "react";

/**
 * One share read per request, whoever asks. The page, its metadata and the
 * poster's `generateImageMetadata` all resolve in the page's request, and two
 * separate `cache()` wrappers would each read the share for themselves.
 */
export const loadSharelink = cache(getSharelink);
