import { projectRoutes } from "@/modules/project";
import type { Metadata } from "next";

type Props = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const { project } = projectRoutes;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const projectId = Number((await params).projectId);
  const title = await project.loadTitle?.({ kind: "project", projectId });

  return title ? { title } : {};
}

export default async function ActualProjectPage({
  params,
  searchParams,
}: Props) {
  const projectId = Number((await params).projectId);

  return project.Page({
    route: { kind: "project", projectId },
    searchParams: await searchParams,
  });
}
