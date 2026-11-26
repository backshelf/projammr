import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { TableActionResult } from "@/components/tables/generic-table-types";
import type {
  ActionContext,
  CommandContext,
} from "@/components/commands/types";

const toastSuccess = mock();
const toastDismiss = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: mock(), dismiss: toastDismiss },
}));

const { HISTORY_COMMANDS } = await import("@/components/commands/history");
const { toastActionResult } = await import("@/lib/action-toast");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeContext(repeatLast: () => void = () => {}): CommandContext {
  return {
    repeatLast,
    count: 1,
    surface: undefined,
  } as unknown as ActionContext & CommandContext;
}

const undoCommand = HISTORY_COMMANDS.find((c) => c.id === "undo")!;
const repeatCommand = HISTORY_COMMANDS.find(
  (c) => c.id === "repeat-last-command"
)!;

beforeEach(() => {
  // Close whatever the previous test left offering Undo.
  for (const call of [...toastSuccess.mock.calls]) call[1]?.onAutoClose?.();
  toastSuccess.mockClear();
  toastDismiss.mockClear();
});

describe("undo command", () => {
  it("is in the General group, bound to u, and never repeatable", () => {
    expect(undoCommand.group).toBe("General");
    expect(undoCommand.keys).toEqual(["u"]);
    expect(undoCommand.repeatable).toBeUndefined();
  });

  it("is unavailable while no toast offers Undo", () => {
    expect(undoCommand.when?.(makeContext())).toBe(false);
  });

  it("is available while a toast offers Undo, and runs its undo", async () => {
    const undo = mock(async (): Promise<TableActionResult> => ({
      ok: true,
      message: "Back",
    }));
    toastActionResult({ ok: true, message: "Archived", undo });
    expect(undoCommand.when?.(makeContext())).toBe(true);

    void undoCommand.run(makeContext());
    await flush();

    expect(undo).toHaveBeenCalledTimes(1);
    expect(undoCommand.when?.(makeContext())).toBe(false);
  });
});

describe("repeat-last-command command", () => {
  it("is in the General group, bound to `.`, and never repeatable", () => {
    expect(repeatCommand.group).toBe("General");
    expect(repeatCommand.keys).toEqual(["."]);
    expect(repeatCommand.repeatable).toBeUndefined();
  });

  it("asks the registry to repeat the last command", () => {
    const repeatLast = mock();
    void repeatCommand.run(makeContext(repeatLast));
    expect(repeatLast).toHaveBeenCalledTimes(1);
  });
});
