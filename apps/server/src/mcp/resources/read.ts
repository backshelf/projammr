import { defineResource } from "../spec.js";
import { getProjectDetail, listProjects } from "../tools/read.js";

export const RESOURCES = [
  defineResource({
    template: "projammr://projects",
    name: "projects",
    title: "Projects",
    description: "Every project the caller is a member of.",
    mimeType: "application/json",
    read: async (actor) => JSON.stringify(await listProjects(actor)),
  }),
  defineResource({
    template: "projammr://projects/{projectId}",
    name: "project",
    title: "Project detail",
    description:
      "One project's detail, with its statuses, priority scale, labels and members.",
    mimeType: "application/json",
    read: async (actor, params) =>
      JSON.stringify(await getProjectDetail(actor, Number(params.projectId))),
  }),
];
