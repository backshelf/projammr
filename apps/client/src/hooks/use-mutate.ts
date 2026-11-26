"use client";

import { applyMutation, type Mutation } from "@/lib/mutation";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/** A stable callback that runs a `Mutation` and applies what it declares it invalidates. */
export function useMutate() {
  const router = useRouter();

  return useCallback(
    <T>(mutation: Mutation<T>) => applyMutation(mutation, router),
    [router]
  );
}
