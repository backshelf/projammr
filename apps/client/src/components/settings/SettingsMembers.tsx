"use client";

import {
  createInvite,
  removeMember,
  revokeInvite,
  transferOwnership,
  updateMemberRole,
} from "@/actions/members";
import { useCopyText } from "@/components/copy-text/CopyTextProvider";
import { LeaveProjectDialog } from "@/components/project/LeaveProjectDialog";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { useSetting } from "@/lib/settings/provider";
import { useDeleteGate } from "@/hooks/use-delete-gate";
import { useProjectRole } from "@/hooks/use-project-role";
import { useFormat } from "@workspace/ui/components/format-provider";
import { zodResolver } from "@hookform/resolvers/zod";
import { IconCopy, IconCrown, IconTrash } from "@tabler/icons-react";
import type {
  AssignableRole,
  ProjectInvite,
  ProjectMember,
} from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import { Button } from "@workspace/ui/components/button";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { Field, FieldError } from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { pluralizeCount } from "@workspace/session-diff/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

/** Ownership moves only by transfer, so it is never offered as a role here. */
const ASSIGNABLE_ROLES: AssignableRole[] = ["admin", "editor", "viewer"];

const inviteSchema = z.object({
  email: z.email("Enter a valid email address"),
  role: z.enum(["admin", "editor", "viewer"]),
});

type InviteFormData = z.infer<typeof inviteSchema>;

export default function SettingsMembers({
  projectId,
  projectName,
  currentUserId,
  members,
  invites,
}: {
  projectId: number;
  projectName: string;
  currentUserId: string;
  members: ProjectMember[];
  invites: ProjectInvite[];
}) {
  const copyText = useCopyText();
  const projectRole = useProjectRole();
  const format = useFormat();
  const canManage = projectRole?.can("admin") ?? false;
  const isOwner = projectRole?.role === "owner";
  const whoMayInvite = useSetting("project-sharing.whoMayInvite");
  const inviteRole = useSetting("project-sharing.inviteRole");
  const inviteDays = useSetting("project-sharing.inviteDays");
  const canInvite = projectRole?.can(whoMayInvite) ?? false;
  // An invite grants at most the inviter's own role.
  const invitableRoles = ASSIGNABLE_ROLES.filter(
    (role) => projectRole?.can(role) ?? false
  );

  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<ProjectMember | null>(
    null
  );
  const [leaving, setLeaving] = useState(false);

  const form = useForm<InviteFormData>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      role: invitableRoles.includes(inviteRole)
        ? inviteRole
        : (invitableRoles[0] ?? "viewer"),
    },
  });

  const handleRoleChange = async (userId: string, role: AssignableRole) => {
    setPendingUserId(userId);
    const result = await updateMemberRole(projectId, userId, role);
    setPendingUserId(null);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Role updated");
  };

  const handleRemove = async (userId: string) => {
    setPendingUserId(userId);
    const result = await removeMember(projectId, userId);
    setPendingUserId(null);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Member removed");
  };

  // Holds the member itself, not their id: the removal's refresh drops them
  // from `members` while the confirm is still closing.
  const removal = useDeleteGate<ProjectMember>("member", (member) =>
    handleRemove(member.userId!)
  );
  const removing = removal.pending;

  const handleTransfer = async () => {
    const target = transferTarget;
    if (!target?.userId) return;
    const result = await transferOwnership(projectId, target.userId);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    toast.success(`${target.user?.name ?? "They"} now own this project`);
    setTransferTarget(null);
  };

  const handleInvite = async (data: InviteFormData) => {
    const result = await createInvite(projectId, data);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    toast.success(`Invited ${data.email}`);
    form.reset({ email: "", role: data.role });
  };

  const handleRevoke = async (inviteId: number) => {
    const result = await revokeInvite(inviteId);
    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }
    toast.success("Invite revoked");
  };

  const copyInviteLink = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`;
    void copyText(url, { success: "Invite link copied" });
  };

  return (
    <div className="flex flex-col gap-11">
      <section>
        <SectionHead count={members.length}>MEMBERS</SectionHead>
        <Rows>
          {members.map((member) => {
            const user = member.user;
            const isSelf = member.userId === currentUserId;
            return (
              <Row
                key={member.id}
                className="phone:flex-wrap phone:gap-x-3 phone:gap-y-2"
              >
                <Avatar className="size-8 shrink-0">
                  {user?.image && (
                    <AvatarImage src={user.image} alt={user.name} />
                  )}
                  <AvatarFallback>
                    {(user?.name ?? "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <RowMain className="min-w-[min(100%,10rem)]">
                  <RowTitle>
                    {user?.name ?? "Unknown user"}
                    {isSelf && <span className="text-ink-soft"> (you)</span>}
                  </RowTitle>
                </RowMain>
                <div className="flex shrink-0 items-center gap-1.5 phone:ml-auto coarse:gap-2">
                  {canManage && member.userId && member.role !== "owner" ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) =>
                        handleRoleChange(
                          member.userId!,
                          value as AssignableRole
                        )
                      }
                      disabled={pendingUserId === member.userId}
                      items={ASSIGNABLE_ROLES.map((role) => ({
                        value: role,
                        label: role,
                      }))}
                    >
                      <SelectTrigger
                        className="w-28 phone:min-h-11"
                        size="sm"
                        aria-label={`Role for ${user?.name ?? "member"}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNABLE_ROLES.map((role) => (
                          <SelectItem key={role} value={role}>
                            {role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="font-sub text-micro tracking-[0.1em] text-ink-soft uppercase">
                      {member.role}
                    </span>
                  )}
                  {isOwner && member.userId && member.role !== "owner" && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setTransferTarget(member)}
                      disabled={pendingUserId === member.userId}
                      aria-label={`Transfer ownership to ${user?.name ?? "member"}`}
                      className="shrink-0 text-ink-soft hover:text-ink fine:opacity-0 fine:motion-reveal fine:group-focus-within/row:opacity-100 fine:group-hover/row:opacity-100 coarse:size-11 coarse:after:inset-0"
                    >
                      <IconCrown size={14} />
                    </Button>
                  )}
                  {isSelf && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setLeaving(true)}
                      className="shrink-0 text-ink-soft hover:text-danger phone:min-h-11"
                    >
                      Leave
                    </Button>
                  )}
                  {canManage && member.userId && !isSelf && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removal.request(member)}
                      disabled={pendingUserId === member.userId}
                      aria-label={`Remove ${user?.name ?? "member"}`}
                      className="shrink-0 text-ink-soft hover:text-danger fine:opacity-0 fine:motion-reveal fine:group-focus-within/row:opacity-100 fine:group-hover/row:opacity-100 coarse:size-11 coarse:after:inset-0"
                    >
                      <IconTrash size={14} />
                    </Button>
                  )}
                </div>
              </Row>
            );
          })}
        </Rows>
      </section>

      {canInvite && (
        <section>
          <SectionHead>INVITE BY EMAIL</SectionHead>
          <form
            onSubmit={form.handleSubmit(handleInvite)}
            className="flex items-start gap-2 phone:flex-col phone:items-stretch"
          >
            <Field className="flex-1">
              <Input
                type="email"
                placeholder="collaborator@example.com"
                aria-label="Email address"
                {...form.register("email")}
              />
              {form.formState.errors.email && (
                <FieldError>{form.formState.errors.email.message}</FieldError>
              )}
            </Field>
            <Select
              value={form.watch("role")}
              onValueChange={(value) =>
                form.setValue("role", value as InviteFormData["role"])
              }
              items={invitableRoles.map((role) => ({
                value: role,
                label: role,
              }))}
            >
              <SelectTrigger
                className="w-28 phone:min-h-11 phone:w-full"
                aria-label="Invite role"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {invitableRoles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="phone:min-h-11 phone:w-full"
            >
              Invite
            </Button>
          </form>
          <p className="mt-2 text-small text-ink-soft">
            Expires in {pluralizeCount(inviteDays, "day")}
          </p>
        </section>
      )}

      {canManage && (
        <section>
          <SectionHead count={invites.length || undefined}>
            PENDING INVITES
          </SectionHead>
          {invites.length === 0 ? (
            <p className="text-small text-ink-soft italic">
              No pending invites.
            </p>
          ) : (
            <Rows>
              {invites.map((invite) => (
                <Row key={invite.id} className="phone:flex-wrap phone:gap-y-2">
                  <RowMain className="phone:basis-full">
                    <RowTitle>{invite.email}</RowTitle>
                    <RowMeta>
                      {invite.role} · invited by{" "}
                      {invite.invitedByName ?? "someone"} · expires{" "}
                      {format.date(invite.expiresAt)}
                    </RowMeta>
                  </RowMain>
                  <div className="flex shrink-0 items-center gap-2 phone:w-full phone:justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyInviteLink(invite.token)}
                      className="shrink-0 text-ink-soft phone:min-h-11"
                    >
                      <IconCopy size={14} />
                      Copy link
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRevoke(invite.id)}
                      aria-label={`Revoke invite for ${invite.email}`}
                      className="shrink-0 text-ink-soft hover:text-danger fine:opacity-0 fine:motion-reveal fine:group-focus-within/row:opacity-100 fine:group-hover/row:opacity-100 coarse:size-11 coarse:after:inset-0"
                    >
                      <IconTrash size={14} />
                    </Button>
                  </div>
                </Row>
              ))}
            </Rows>
          )}
        </section>
      )}

      <ConfirmDeleteDialog
        open={transferTarget !== null}
        onOpenChange={(open) => !open && setTransferTarget(null)}
        title={`Make ${transferTarget?.user?.name ?? "this member"} the owner?`}
        description="They take over the project and you become an admin, losing every owner-only action — including transferring it back. Only the new owner can undo this."
        confirmLabel="Transfer ownership"
        onConfirm={handleTransfer}
      />
      <ConfirmDeleteDialog
        {...removal.dialog}
        title={`Remove ${removing?.user?.name ?? "this member"}?`}
        description={`They lose access to ${projectName}. You can invite them again later.`}
        confirmLabel="Remove member"
      />
      <LeaveProjectDialog
        projectId={projectId}
        projectName={projectName}
        open={leaving}
        onOpenChange={setLeaving}
      />
    </div>
  );
}
