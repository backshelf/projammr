import { describe, expect, it, mock } from "bun:test";
import { COMMAND_BAR_COMMANDS } from "@/components/commands/command-bar";
import type { CommandContext } from "@/components/commands/types";

describe("command-prompt command", () => {
  const command = COMMAND_BAR_COMMANDS.find((c) => c.id === "command-prompt")!;

  it("is bound to `:`, in the General group", () => {
    expect(command.keys).toEqual([":"]);
    expect(command.group).toBe("General");
  });

  it("opens the bar's prompt through the scope's surface", () => {
    const openPrompt = mock();

    command.run({ surface: { openPrompt } } as unknown as CommandContext);

    expect(openPrompt).toHaveBeenCalledTimes(1);
  });
});
