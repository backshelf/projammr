import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

import type { ActionContext } from "@/components/commands/types";

// The prefix commands import server actions that load `server-only`;
// `mock.module` is not hoisted, so it runs before the dynamic import below.
mock.module("server-only", () => ({}));

const { useBarPrompt } =
  await import("@/components/command-bar/use-bar-prompt");

afterEach(cleanup);

function makeCtx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    projectId: null,
    route: { kind: "not-found" },
    setTheme: mock(),
    ...overrides,
  } as unknown as ActionContext;
}

function setup(
  value: string,
  {
    ctx = makeCtx(),
    aliases = {},
  }: { ctx?: ActionContext; aliases?: Record<string, string> } = {}
) {
  const setValue = mock();
  const close = mock();
  const hook = renderHook(() =>
    useBarPrompt({ value, setValue, close, ctx, aliases })
  );
  return { ...hook, setValue, close };
}

describe("useBarPrompt", () => {
  it("offers the matched command's rows for a complete prefix", () => {
    const { result } = setup("theme dark");

    expect(result.current.suggestions.map((s) => s.label)).toEqual(["Dark"]);
  });

  it("opens a command from an alias", () => {
    const { result } = setup("t dark", { aliases: { t: "theme" } });

    expect(result.current.suggestions.map((s) => s.label)).toEqual(["Dark"]);
  });

  it("runs the command with the chosen row", () => {
    const ctx = makeCtx();
    const { result } = setup("theme dark", { ctx });

    act(() => result.current.suggestions[0]!.run());

    expect(ctx.setTheme).toHaveBeenCalledWith("dark");
  });

  it("offers the commands a partial prefix could become", () => {
    const { result } = setup("the");

    expect(result.current.suggestions.map((s) => s.id)).toEqual(["theme"]);
  });

  it("leaves out a command that is unavailable here", () => {
    const partial = setup("pla").result.current.suggestions;
    expect(partial.map((s) => s.id)).not.toContain("play");

    const complete = setup("play low").result.current.suggestions;
    expect(complete).toEqual([]);
  });

  it("completes a command into the line and keeps the prompt open", () => {
    const { result, setValue, close } = setup("the");

    act(() => {
      result.current.suggestions[0]!.run();
      result.current.onClose();
    });

    expect(setValue).toHaveBeenCalledWith("theme ");
    expect(close).not.toHaveBeenCalled();
  });

  it("closes the prompt after a row is chosen", () => {
    const { result, close } = setup("theme dark");

    act(() => {
      result.current.suggestions[0]!.run();
      result.current.onClose();
    });

    expect(close).toHaveBeenCalledTimes(1);
  });
});
