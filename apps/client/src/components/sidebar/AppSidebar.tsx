import { AppLink } from "@/components/navigation/AppLink";
import { SIDEBAR_EYEBROW } from "@workspace/ui/lib/shell";
import { cachedShellData } from "@/lib/server-data";
import { SETTINGS_HREF } from "@/lib/settings/href";
import { Loading } from "@workspace/ui/components/layout/loading";
import { AppSidebarGroup } from "@/components/sidebar/AppSidebarGroup";
import AppSidebarHeader from "@/components/sidebar/AppSidebarHeader";
import SignOutDropdownMenuItem from "@/components/sidebar/SignOutDropdownMenuItem";
import { getCachedSession, sessionUser } from "@/lib/session";
import { initials, mediaProxyUrl } from "@/lib/utils";
import { IconUserCircle } from "@tabler/icons-react";
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
import {
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@workspace/ui/components/sidebar";
import { ResponsiveSidebar } from "@/components/sidebar/ResponsiveSidebar";
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
          "pb-[calc(var(--player-card)+0.5rem)] phone:pb-2"
        }
      >
        <SidebarMenu>
          <SidebarMenuItem className={"flex items-center gap-1"}>
            <Suspense fallback={<SignedOutAccount />}>
              <SidebarAccount />
            </Suspense>
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

  return (
    <AppSidebarHeader projects={projects} currentProject={currentProject} />
  );
}

async function SidebarGroups() {
  const { currentProject } = await cachedShellData();

  return <AppSidebarGroup project={currentProject ?? undefined} />;
}

function SignedOutAccount() {
  return (
    <SidebarMenuButton size={"lg"} className={"flex-1"} asChild>
      <AppLink href={"/"}>
        <Avatar>
          <AvatarFallback>
            <IconUserCircle />
          </AvatarFallback>
        </Avatar>
        Sign in
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
        <SidebarMenuButton size={"lg"} className={"flex-1"}>
          <Avatar>
            <AvatarImage src={mediaProxyUrl(user.image)} alt="avatar" />
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className={"flex min-w-0 flex-col text-left"}>
            <span className={SIDEBAR_EYEBROW}>Account</span>
            <span className={"truncate"}>{user.name}</span>
          </div>
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem asChild>
          <AppLink href="/profile">Profile</AppLink>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <AppLink href={SETTINGS_HREF}>Settings</AppLink>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <SignOutDropdownMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
