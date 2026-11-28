import { AppLink } from "@/components/navigation/AppLink";
import { AppSidebarGroup } from "@/components/sidebar/AppSidebarGroup";
import AppSidebarHeader from "@/components/sidebar/AppSidebarHeader";
import { ResponsiveSidebar } from "@/components/sidebar/ResponsiveSidebar";
import SignOutDropdownMenuItem from "@/components/sidebar/SignOutDropdownMenuItem";
import { cachedSidebarProjectToday } from "@/components/sidebar/sidebar-reads";
import { roleSatisfies } from "@/lib/roles";
import { cachedShellData } from "@/lib/server-data";
import { getCachedSession, sessionUser } from "@/lib/session";
import { SETTINGS_HREF } from "@/lib/settings/href";
import { initials, mediaProxyUrl } from "@/lib/utils";
import { IconSettings, IconUserCircle } from "@tabler/icons-react";
import { isActionError } from "@workspace/api/lib/action-result";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Loading } from "@workspace/ui/components/layout/loading";
import {
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { Suspense } from "react";

/**
 * The sidebar sits in the root layout, so anything it awaits delays the whole
 * page. It renders its shell synchronously and streams the project list and
 * the per-project groups in behind their own boundaries.
 */
export const AppSidebar = () => {
  return (
    <ResponsiveSidebar>
      <Suspense fallback={null}>
        <SidebarProjects />
      </Suspense>
      <SidebarContent>
        <Loading>
          <SidebarGroups />
        </Loading>
      </SidebarContent>
      {/* SidebarContent's flex-1 holds this at the bottom of the window. The
          clearance for the player bar is conditional. */}
      <SidebarFooter
        className={
          // The card is anchored over this footer wherever the sidebar is on
          // screen, which is every width down to the phone tier; below it the
          // sidebar is absent and the clearance goes away.
          "border-t border-rule/70 pb-[calc(var(--player-card)+0.5rem)] phone:pb-2"
        }
      >
        <SidebarMenu>
          <SidebarMenuItem className={"flex items-center gap-0.5"}>
            <Suspense fallback={<SignedOutAccount />}>
              <SidebarAccount />
            </Suspense>
            <Tooltip>
              <TooltipTrigger asChild>
                <AppLink
                  href={SETTINGS_HREF}
                  aria-label={"Settings"}
                  className={
                    "flex size-7 shrink-0 items-center justify-center rounded-sm text-ink-soft motion-ink hover:text-ink focus-visible:ring-2 focus-visible:ring-sidebar-ring/30 focus-visible:outline-hidden"
                  }
                >
                  <IconSettings className={"size-4"} aria-hidden />
                </AppLink>
              </TooltipTrigger>
              <TooltipContent>Settings</TooltipContent>
            </Tooltip>
            <SidebarTrigger
              className={"shrink-0 text-ink-soft hover:text-ink"}
              aria-label={"Hide sidebar"}
            />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </ResponsiveSidebar>
  );
};

async function SidebarProjects() {
  const { user, projects, currentProject } = await cachedShellData();

  if (!user) return null;

  const canEdit =
    currentProject != null && roleSatisfies(currentProject.role, "editor");
  const today = canEdit
    ? await cachedSidebarProjectToday(currentProject.id)
    : null;
  const unassignedCount =
    today && !isActionError(today) ? today.unassignedSets.total : 0;

  return (
    <AppSidebarHeader
      projects={projects}
      currentProject={currentProject}
      unassignedCount={unassignedCount}
    />
  );
}

async function SidebarGroups() {
  const { currentProject } = await cachedShellData();

  return <AppSidebarGroup project={currentProject ?? undefined} />;
}

function SignedOutAccount() {
  return (
    <SidebarMenuButton size={"default"} className={"min-w-0 flex-1"} asChild>
      <AppLink href={"/"}>
        <Avatar className={"size-5 shrink-0"}>
          <AvatarFallback className={"text-micro"}>
            <IconUserCircle className={"size-3.5"} aria-hidden />
          </AvatarFallback>
        </Avatar>
        <span className={"truncate"}>Sign in</span>
      </AppLink>
    </SidebarMenuButton>
  );
}

async function SidebarAccount() {
  const session = await getCachedSession();
  const user = sessionUser(session);

  if (!user) return <SignedOutAccount />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton size={"default"} className={"min-w-0 flex-1"}>
          <Avatar className={"size-5 shrink-0"}>
            <AvatarImage src={mediaProxyUrl(user.image)} alt="" />
            <AvatarFallback className={"text-micro"}>
              {initials(user.name)}
            </AvatarFallback>
          </Avatar>
          <span className={"truncate"}>{user.name}</span>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <AppLink href="/profile">Profile</AppLink>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <SignOutDropdownMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
