import React, { PropsWithChildren, Suspense } from "react";
import { Spinner } from "@workspace/ui/components/spinner";

export const Loading = ({ children }: PropsWithChildren) => {
  return (
    <Suspense fallback={<Spinner className="w-12" />}>{children}</Suspense>
  );
};
