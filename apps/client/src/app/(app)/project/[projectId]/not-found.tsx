import { RouteNotFound } from "@/components/project/RouteState";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Not found" };

export default function ProjectNotFound() {
  return <RouteNotFound />;
}
