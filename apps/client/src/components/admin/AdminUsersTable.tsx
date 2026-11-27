"use client";

import { createResetLink, updateInstanceUser } from "@/actions/admin";
import {
  isOnlyEnabledAdmin,
  resetLinkDialogReducer,
} from "@/components/admin/admin-users-logic";
import CopyButton from "@/components/CopyButton";
import { PageLinks } from "@/components/tables/PageLinks";
import type { InstanceUsersPage } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import { useFormat } from "@workspace/ui/components/format-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { isActionError } from "@workspace/api/lib/action-result";
import { useReducer, useState, useTransition } from "react";
import { toast } from "sonner";

const LAST_ADMIN_REASON =
  "The instance needs at least one admin who can sign in.";

export function AdminUsersTable({ data }: { data: InstanceUsersPage }) {
  const { rows, rowCount, page, pageSize } = data;
  const format = useFormat();
  const [pending, startTransition] = useTransition();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [resetLink, dispatchResetLink] = useReducer(
    resetLinkDialogReducer,
    null
  );

  const applyPatch = async (
    userId: string,
    patch: Parameters<typeof updateInstanceUser>[1]
  ) => {
    setBusyUserId(userId);
    const result = await updateInstanceUser(userId, patch);
    setBusyUserId(null);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    startTransition(() => {
      // A patch changes what this page shows (role, disabled), so the server
      // component above has to refetch it — there is no client-side copy of
      // the row to update in place.
      window.location.reload();
    });
  };

  const handleCreateResetLink = async (userId: string) => {
    setBusyUserId(userId);
    const result = await createResetLink(userId);
    setBusyUserId(null);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    dispatchResetLink({ type: "shown", userId, url: result.url });
  };

  return (
    <>
      <Table variant="entity">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead className="num">Storage</TableHead>
            <TableHead className="num">Projects</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((user) => {
            const isLastAdmin = isOnlyEnabledAdmin(user, rows);
            const roleReason = isLastAdmin ? LAST_ADMIN_REASON : undefined;
            const disableReason = isLastAdmin ? LAST_ADMIN_REASON : undefined;
            const busy = busyUserId === user.id || pending;

            return (
              <TableRow key={user.id}>
                <TableCell>{user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  {user.instanceRole === "admin" ? "Admin" : "User"}
                </TableCell>
                <TableCell>
                  {user.lastSeenAt ? format.relative(user.lastSeenAt) : "Never"}
                </TableCell>
                <TableCell className="num tabular-nums">
                  {format.bytes(user.storageBytes, 1)}
                </TableCell>
                <TableCell className="num tabular-nums">
                  {user.projectCount}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <span title={roleReason}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !!roleReason}
                        onClick={() =>
                          applyPatch(user.id, {
                            instanceRole:
                              user.instanceRole === "admin" ? "user" : "admin",
                          })
                        }
                      >
                        {user.instanceRole === "admin"
                          ? "Remove admin"
                          : "Make admin"}
                      </Button>
                    </span>
                    <span title={disableReason}>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy || !!disableReason}
                        onClick={() =>
                          applyPatch(user.id, { disabled: !user.disabled })
                        }
                      >
                        {user.disabled ? "Enable" : "Disable"}
                      </Button>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => handleCreateResetLink(user.id)}
                    >
                      Create reset link
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <PageLinks page={page} pageSize={pageSize} rowCount={rowCount} />

      <Dialog
        open={resetLink !== null}
        onOpenChange={(open) => !open && dispatchResetLink({ type: "closed" })}
      >
        <DialogContent className="bg-paper">
          <DialogHeader>
            <DialogTitle>Reset link</DialogTitle>
            <DialogDescription>
              Hand this to the account holder directly. It works once, for the
              next hour, and will not be shown again — closing this dialog is
              the only copy of it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={resetLink?.url ?? ""} />
            <CopyButton value={resetLink?.url ?? ""} label="Copy reset link" />
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </>
  );
}
