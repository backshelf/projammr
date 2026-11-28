import { getProjectSamples, getProjectToday } from "@/actions/projects";
import { cache } from "react";

export const cachedSidebarProjectToday = cache(getProjectToday);
export const cachedSidebarProjectSamples = cache(getProjectSamples);
