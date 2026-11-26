import { getAdminUsers } from "@/actions/admin";
import { AdminUsersTable } from "@/components/admin/AdminUsersTable";
import { parsePageParam } from "@/lib/table-params";
import { isActionError } from "@workspace/api/lib/action-result";
import type { HubPane, HubPaneProps } from "./types";

const USERS_PAGE_SIZE = 20;

async function Users({ searchParams }: HubPaneProps) {
  const result = await getAdminUsers(
    parsePageParam(searchParams),
    USERS_PAGE_SIZE
  );
  if (isActionError(result)) {
    return <p className="text-small text-ink-soft">{result.error}</p>;
  }
  return <AdminUsersTable data={result} />;
}

/** Every account on the instance, with what an admin can do to each. */
export const UsersPane: HubPane = {
  id: "users",
  section: "instance",
  label: "Users",
  order: 20,
  Content: Users,
};
