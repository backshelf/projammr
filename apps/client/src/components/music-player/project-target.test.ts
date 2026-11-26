import { describe, expect, it, mock } from "bun:test";
import { effectiveSettings } from "@/lib/settings/effective";
import { createProjectTargetResolver } from "./project-target";

const settingsWith = (target: number) =>
  effectiveSettings({ "lab.normaliseTarget": target }, "v1");

describe("createProjectTargetResolver", () => {
  it("answers a project's normalise target from its effective settings", async () => {
    const resolve = createProjectTargetResolver(async () => settingsWith(-20));

    expect(await resolve(7)).toBe(-20);
  });

  it("reads each project once, however often it is asked", async () => {
    const read = mock(async () => settingsWith(-20));
    const resolve = createProjectTargetResolver(read);

    await Promise.all([resolve(7), resolve(7)]);
    await resolve(7);
    await resolve(8);

    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenNthCalledWith(1, 7);
    expect(read).toHaveBeenNthCalledWith(2, 8);
  });

  it("answers null for a read that fails, and reads again the next time", async () => {
    const read = mock(async () => settingsWith(-20));
    read.mockResolvedValueOnce({
      error: "Couldn't read your settings",
    } as never);
    const resolve = createProjectTargetResolver(read);

    expect(await resolve(7)).toBeNull();
    expect(await resolve(7)).toBe(-20);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("answers null for a read that throws, and reads again the next time", async () => {
    const read = mock(async () => settingsWith(-20));
    read.mockRejectedValueOnce(new Error("offline"));
    const resolve = createProjectTargetResolver(read);

    expect(await resolve(7)).toBeNull();
    expect(await resolve(7)).toBe(-20);
  });
});
