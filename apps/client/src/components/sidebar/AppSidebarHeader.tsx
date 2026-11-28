import { JobsTray } from "@/components/jobs/JobsTray";
import { AppLink } from "@/components/navigation/AppLink";
import LeaveProjectDropdownMenuItem, {
  LeaveProjectScope,
} from "@/components/sidebar/LeaveProjectDropdownMenuItem";
import { SidebarNavLink } from "@/components/sidebar/SidebarNavLink";
import { SidebarSearchTrigger } from "@/components/sidebar/SidebarSearchTrigger";
import {
  hrefFromParsedRoute,
  initials,
  mediaProxyUrl,
  NEW_PROJECT_HREF,
} from "@/lib/utils";
import { IconHome, IconPlus, IconSelector } from "@tabler/icons-react";
import { Project } from "@workspace/api/api";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@workspace/ui/components/sidebar";

export default async function AppSidebarHeader({
  projects,
  currentProject,
  unassignedCount = 0,
}: {
  projects: Pick<Project, "name" | "image" | "id">[];
  currentProject?: Pick<Project, "name" | "image" | "id">;
  unassignedCount?: number;
}) {
  return (
    <SidebarHeader className={"border-b border-rule/70"}>
      <SidebarMenu className={"gap-1"}>
        <SidebarMenuItem className={"flex items-center gap-1"}>
          <LeaveProjectScope project={currentProject}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size={"default"}
                  className={
                    "min-w-0 flex-1 items-center justify-between gap-2 text-ink"
                  }
                >
                  <span className={"flex min-w-0 items-center gap-2"}>
                    <Avatar className={"size-5 shrink-0 rounded-sm"}>
                      <AvatarImage
                        src={mediaProxyUrl(currentProject?.image)}
                        alt=""
                      />
                      <AvatarFallback className={"rounded-sm text-micro"}>
                        {currentProject && initials(currentProject.name)}
                      </AvatarFallback>
                    </Avatar>

                    {currentProject?.name ? (
                      <span className={"truncate font-medium text-ink"}>
                        {currentProject.name}
                      </span>
                    ) : (
                      <span className={"truncate text-ink-soft italic"}>
                        Select a project…
                      </span>
                    )}
                  </span>

                  <IconSelector
                    className={"size-3.5 shrink-0 text-ink-faint"}
                    aria-hidden
                  />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Your projects</DropdownMenuLabel>
                  {projects.length !== 0 ? (
                    projects.map((project) => (
                      <DropdownMenuItem key={project.id} asChild>
                        <AppLink
                          href={hrefFromParsedRoute(
                            { kind: "project" },
                            project.id
                          )}
                        >
                          <span>{project.name}</span>
                        </AppLink>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuLabel>No projects</DropdownMenuLabel>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <AppLink href={NEW_PROJECT_HREF}>
                      <IconPlus />
                      Add New
                    </AppLink>
                  </DropdownMenuItem>
                  <LeaveProjectDropdownMenuItem />
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </LeaveProjectScope>
          {currentProject && <JobsTray />}
        </SidebarMenuItem>

        {currentProject && (
          <>
            <SidebarMenuItem>
              <SidebarSearchTrigger />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarNavLink
                href={hrefFromParsedRoute(
                  { kind: "project" },
                  currentProject.id
                )}
                className={"flex items-center gap-2"}
              >
                <IconHome
                  className={
                    "size-3.5 shrink-0 text-ink-faint group-hover/menu-button:text-ink group-data-[active=true]/menu-button:text-ink"
                  }
                  aria-hidden
                />
                <span>Home</span>
                {unassignedCount > 0 && (
                  <span
                    role="img"
                    aria-label={`${unassignedCount} unassigned DAW sets`}
                    className={"ml-auto size-1.5 shrink-0 rounded-full bg-art"}
                  />
                )}
              </SidebarNavLink>
            </SidebarMenuItem>
          </>
        )}
      </SidebarMenu>
    </SidebarHeader>
  );
}
