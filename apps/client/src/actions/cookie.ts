"use server";
import { cookies } from "next/headers";

export const setProjectCookie = async (projectId: number | undefined) => {
  const cookieStore = await cookies();
  if (projectId) {
    cookieStore.set("currentProject", String(projectId));
  } else {
    cookieStore.delete("currentProject");
  }
};
