import "server-only";
import { headers } from "next/headers";

export const getCookie = async () => (await headers()).get("cookie");

export const getOrigin = async () => (await headers()).get("origin");

export const getForwardedFor = async () =>
  (await headers()).get("x-forwarded-for");
