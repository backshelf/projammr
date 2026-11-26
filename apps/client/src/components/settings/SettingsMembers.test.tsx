import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock, type Mock } from "bun:test";
import type {
  MemberRole,
  ProjectInvite,
  ProjectMember,
} from "@workspace/api/api";

mock.module("@/lib/browser-api", () => ({
  browserApi: { GET: mock(), PATCH: mock() },
}));

mock.module("@/actions/members", () => ({
  createInvite: mock(),
  leaveProject: mock(),
  removeMember: mock(),
  revokeInvite: mock(),
  transferOwnership: mock(),
  updateMemberRole: mock(),
}));

mock.module("@/actions/cookie", () => ({ setProjectCookie: mock() }));

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock() }),
}));

mock.module("@/components/copy-text/CopyTextProvider", () => ({
  useCopyText: () => mock(),
}));

const RANK: Record<MemberRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

let viewerRole: MemberRole = "owner";

mock.module("@/hooks/use-project-role", () => ({
  useProjectRole: () => ({
    role: viewerRole,
    can: (min: MemberRole) => RANK[viewerRole] >= RANK[min],
  }),
}));

mock.module("sonner", () => ({ toast: { success: mock(), error: mock() } }));

const { default: SettingsMembers } = await import("./SettingsMembers");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");
const { PoliciesProvider } = await import("@/lib/policies/provider");
const { DEFAULT_POLICIES } = await import("@/lib/policies/policies");
const { removeMember } = await import("@/actions/members");

afterEach(() => {
  cleanup();
  removeMemberMock.mockReset();
});

const member = (
  id: number,
  userId: string,
  name: string,
  role: MemberRole
): ProjectMember =>
  ({
    id,
    userId,
    role,
    user: { id: userId, name, image: null },
  }) as ProjectMember;

const invite = {
  id: 9,
  email: "cy@example.com",
  role: "viewer",
  token: "t",
  expiresAt: "2030-01-01T00:00:00.000Z",
  invitedByName: "Ada",
} as ProjectInvite;

const renderMembers = async (
  members: ProjectMember[],
  settings: Record<string, unknown> = {},
  invites: ProjectInvite[] = [],
  confirmMemberRemoval = true
) => {
  await act(async () => {
    render(
      <PoliciesProvider
        policies={{
          ...DEFAULT_POLICIES,
          feedback: {
            ...DEFAULT_POLICIES.feedback,
            confirmDeletes: {
              ...DEFAULT_POLICIES.feedback.confirmDeletes,
              member: confirmMemberRemoval,
            },
          },
        }}
      >
        <SettingsProvider initial={effectiveSettings(settings, "v1")}>
          <SettingsMembers
            projectId={1}
            projectName="Night Signals"
            currentUserId="u1"
            members={members}
            invites={invites}
          />
        </SettingsProvider>
      </PoliciesProvider>
    );
  });
};

const removeMemberMock = removeMember as unknown as Mock<typeof removeMember>;

describe("SettingsMembers", () => {
  it("defaults the invite role to the project's setting", async () => {
    viewerRole = "owner";
    await renderMembers([], { "project-sharing.inviteRole": "editor" });

    expect(
      screen.getByRole("combobox", { name: "Invite role" }).textContent
    ).toBe("editor");
  });

  it("shows how long an invite lasts, in the singular for one day", async () => {
    viewerRole = "owner";
    await renderMembers([], { "project-sharing.inviteDays": 1 });
    expect(screen.getByText("Expires in 1 day")).toBeDefined();

    cleanup();
    await renderMembers([], { "project-sharing.inviteDays": 3 });
    expect(screen.getByText("Expires in 3 days")).toBeDefined();
  });

  it("lets an editor invite, without the pending list, when editors may", async () => {
    viewerRole = "editor";
    await renderMembers([], { "project-sharing.whoMayInvite": "editor" }, [
      invite,
    ]);

    expect(screen.getByRole("combobox", { name: "Invite role" })).toBeDefined();
    expect(screen.queryByText("PENDING INVITES")).toBeNull();
  });

  it("falls back to the highest role an editor may grant", async () => {
    viewerRole = "editor";
    await renderMembers([], {
      "project-sharing.whoMayInvite": "editor",
      "project-sharing.inviteRole": "admin",
    });

    expect(
      screen.getByRole("combobox", { name: "Invite role" }).textContent
    ).toBe("editor");
  });

  it("shows an editor neither the form nor the pending list when admins invite", async () => {
    viewerRole = "editor";
    await renderMembers([], { "project-sharing.whoMayInvite": "admin" }, [
      invite,
    ]);

    expect(screen.queryByRole("combobox", { name: "Invite role" })).toBeNull();
    expect(screen.queryByText("PENDING INVITES")).toBeNull();
  });

  it("shows an admin the form and the pending list", async () => {
    viewerRole = "admin";
    await renderMembers([], {}, [invite]);

    expect(screen.getByRole("combobox", { name: "Invite role" })).toBeDefined();
    expect(screen.getByText("PENDING INVITES")).toBeDefined();
  });

  it("offers Leave, not Remove, on the caller's own row", async () => {
    viewerRole = "owner";
    await renderMembers([
      member(1, "u1", "Ada", "owner"),
      member(2, "u2", "Bo", "editor"),
    ]);

    expect(screen.getAllByRole("button", { name: "Leave" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Remove Ada" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Bo" })).toBeDefined();
  });

  describe("removing a member", () => {
    const roster = () => [
      member(1, "u1", "Ada", "owner"),
      member(2, "u2", "Bo", "editor"),
    ];

    it("asks first, and removes only once confirmed", async () => {
      viewerRole = "owner";
      removeMemberMock.mockResolvedValue({} as never);
      await renderMembers(roster());

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Remove Bo" }));
      });
      expect(screen.getByText("Remove Bo?")).toBeDefined();
      expect(removeMemberMock).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Remove member" }));
      });
      expect(removeMemberMock).toHaveBeenCalledWith(1, "u2");
    });

    it("removes nobody when the confirm is cancelled", async () => {
      viewerRole = "owner";
      await renderMembers(roster());

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Remove Bo" }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      });

      expect(removeMemberMock).not.toHaveBeenCalled();
    });

    it("removes at once when member removals are switched off", async () => {
      viewerRole = "owner";
      removeMemberMock.mockResolvedValue({} as never);
      await renderMembers(roster(), {}, [], false);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Remove Bo" }));
      });

      expect(screen.queryByText("Remove Bo?")).toBeNull();
      expect(removeMemberMock).toHaveBeenCalledWith(1, "u2");
    });
  });

  it("offers Leave to a viewer, who can remove nobody", async () => {
    viewerRole = "viewer";
    await renderMembers([
      member(1, "u1", "Ada", "viewer"),
      member(2, "u2", "Bo", "owner"),
    ]);

    expect(screen.getAllByRole("button", { name: "Leave" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
  });
});
