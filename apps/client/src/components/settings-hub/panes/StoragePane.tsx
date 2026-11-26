import { getAdminStorage } from "@/actions/admin";
import { AdminStorageSection } from "@/components/admin/AdminStorageSection";
import { cachedFormatters } from "@/lib/formatters";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane } from "./types";

async function Storage() {
  const [storage, format] = await Promise.all([
    getAdminStorage(),
    cachedFormatters(),
  ]);
  if (isActionError(storage)) {
    return <p className="text-small text-ink-soft">{storage.error}</p>;
  }
  return <AdminStorageSection storage={storage} format={format} />;
}

/** Storage across the instance, by project and by account. */
export const StoragePane: HubPane = {
  id: "storage",
  section: "instance",
  label: "Storage",
  order: 30,
  Content: Storage,
};
