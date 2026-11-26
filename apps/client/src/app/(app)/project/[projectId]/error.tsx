"use client";

import { RouteError } from "@/components/project/RouteState";

export default function ProjectError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteError retry={retry} />;
}
