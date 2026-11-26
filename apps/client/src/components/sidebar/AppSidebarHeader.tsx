import { SIDEBAR_EYEBROW } from "@workspace/ui/lib/shell";
import { Loading } from "@workspace/ui/components/layout/loading";
import { JobsTray } from "@/components/jobs/JobsTray";
import { AppLink } from "@/components/navigation/AppLink";
import LeaveProjectDropdownMenuItem, {
  LeaveProjectScope,
} from "@/components/sidebar/LeaveProjectDropdownMenuItem";
import { SidebarSearchTrigger } from "@/components/sidebar/SidebarSearchTrigger";
import { SETTINGS_HREF } from "@/lib/settings/href";
import {
  hrefFromParsedRoute,
  initials,
  mediaProxyUrl,
  NEW_PROJECT_HREF,
} from "@/lib/utils";
import { IconPlus, IconSelector } from "@tabler/icons-react";
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
}: {
  projects: Pick<Project, "name" | "image" | "id">[];
  currentProject?: Pick<Project, "name" | "image" | "id">;
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
                  <div className={"flex items-center gap-2"}>
                    <Loading>
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
                        <div className={"flex min-w-0 flex-col text-left"}>
                          <span className={SIDEBAR_EYEBROW}>Project</span>
                          <span className={"truncate"}>
                            {currentProject.name}
                          </span>
                        </div>
                      ) : (
                        <p
                          className={
                            "translate-y-[5%] text-small text-ink-soft italic"
                          }
                        >
                          Select a project...
                        </p>
                      )}
                    </Loading>
                  </div>

                  <IconSelector className={"translate-y-[5%]"} />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Your projects</DropdownMenuLabel>
                  <Loading>
                    {projects.length !== 0 ? (
                      projects.map((project) => {
                        return (
                          <DropdownMenuItem key={project.id}>
                            <AppLink
                              href={hrefFromParsedRoute(
                                { kind: "project" },
                                project.id
                              )}
                            >
                              <p>{project.name}</p>
                            </AppLink>
                          </DropdownMenuItem>
                        );
                      })
                    ) : (
                      <DropdownMenuLabel>
                        <p>No projects</p>
                      </DropdownMenuLabel>
                    )}
                  </Loading>
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
                >
                  View project
                </AppLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </>
        )}
        <SidebarMenuItem>
          <SidebarMenuButton asChild>
            <AppLink href={SETTINGS_HREF}>Settings</AppLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarHeader>
  );
}
