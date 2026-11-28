import { SIDEBAR_EYEBROW } from "@workspace/ui/lib/shell";
import { JobsTray } from "@/components/jobs/JobsTray";
import { AppLink } from "@/components/navigation/AppLink";
import LeaveProjectDropdownMenuItem, {
  LeaveProjectScope,
} from "@/components/sidebar/LeaveProjectDropdownMenuItem";
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
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <LeaveProjectScope project={currentProject}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size={"lg"}
                  className={"flex items-center justify-between gap-2"}
                >
                  <span className={"flex min-w-0 items-center gap-2"}>
                    <Avatar>
                      <AvatarImage
                        src={mediaProxyUrl(currentProject?.image)}
                        alt="avatar"
                      />
                      <AvatarFallback>
                        {currentProject && initials(currentProject.name)}
                      </AvatarFallback>
                    </Avatar>

                    {currentProject?.name ? (
                      <span className={"flex min-w-0 flex-col text-left"}>
                        <span className={SIDEBAR_EYEBROW}>Project</span>
                        <span className={"truncate"}>
                          {currentProject.name}
                        </span>
                      </span>
                    ) : (
                      <span
                        className={
                          "translate-y-[5%] text-small text-ink-soft italic"
                        }
                      >
                        Select a project...
                      </span>
                    )}
                  </span>

                  <IconSelector className={"translate-y-[5%]"} />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Your projects</DropdownMenuLabel>
                  {projects.length !== 0 ? (
                    projects.map((project) => {
                      return (
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
                      );
                    })
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
        </SidebarMenuItem>
        {currentProject && (
          <>
            <SidebarMenuItem className={"flex items-center gap-1"}>
              <SidebarSearchTrigger />
              <JobsTray />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <AppLink
                  href={hrefFromParsedRoute(
                    { kind: "project" },
                    currentProject.id
                  )}
                  className={"flex items-center gap-2"}
                >
                  <IconHome className={"size-4 text-ink-soft"} />
                  <span>Home</span>
                  {unassignedCount > 0 && (
                    <span
                      role="img"
                      aria-label={`${unassignedCount} unassigned DAW sets`}
                      className={"ml-auto size-1.5 rounded-full bg-art"}
                    />
                  )}
                </AppLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </>
        )}
      </SidebarMenu>
    </SidebarHeader>
  );
}
