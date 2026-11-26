import { describe, expect, it, mock } from "bun:test";
import { GRID_COMMANDS, type GridSurface } from "@/components/commands/grid";
import type {
  ActionContext,
  CommandContext,
} from "@/components/commands/types";

function makeSurface(overrides: Partial<GridSurface> = {}): GridSurface {
  return {
    move: mock(),
    extend: mock(),
    selectAll: mock(),
    copy: mock(),
    enter: mock(),
    ...overrides,
  };
}

function makeContext(surface: GridSurface): CommandContext<GridSurface> {
  return { count: 1, surface } as unknown as ActionContext &
    CommandContext<GridSurface>;
}

const byId = (id: string) => GRID_COMMANDS.find((c) => c.id === id)!;

describe("grid commands", () => {
  it.each([
    ["up", "ArrowUp"],
    ["down", "ArrowDown"],
    ["left", "ArrowLeft"],
    ["right", "ArrowRight"],
  ] as const)("moves the cell selection %s on %s", (direction, key) => {
    const surface = makeSurface();
    const command = byId(`grid-move-${direction}`);
    expect(command.keys).toEqual([key]);
    command.run(makeContext(surface));
    expect(surface.move).toHaveBeenCalledWith(direction);
  });

  it.each([
    ["up", "shift+ArrowUp"],
    ["down", "shift+ArrowDown"],
    ["left", "shift+ArrowLeft"],
    ["right", "shift+ArrowRight"],
  ] as const)("extends the cell selection %s on %s", (direction, key) => {
    const surface = makeSurface();
    const command = byId(`grid-extend-${direction}`);
    expect(command.keys).toEqual([key]);
    command.run(makeContext(surface));
    expect(surface.extend).toHaveBeenCalledWith(direction);
  });

  it("selects all cells on mod+a and copies on mod+c", () => {
    const surface = makeSurface();
    expect(byId("grid-select-all").keys).toEqual(["mod+a"]);
    expect(byId("grid-copy").keys).toEqual(["mod+c"]);
    byId("grid-select-all").run(makeContext(surface));
    byId("grid-copy").run(makeContext(surface));
    expect(surface.selectAll).toHaveBeenCalledTimes(1);
    expect(surface.copy).toHaveBeenCalledTimes(1);
  });

  it("edits the focused cell on Enter only when the surface has an entry", () => {
    const command = byId("grid-edit-cell");
    expect(command.keys).toEqual(["Enter"]);
    expect(command.when!(makeContext(makeSurface({ enter: null })))).toBe(
      false
    );

    const enter = mock();
    const surface = makeSurface({ enter });
    expect(command.when!(makeContext(surface))).toBe(true);
    command.run(makeContext(surface));
    expect(enter).toHaveBeenCalledTimes(1);
  });

  it("does nothing on Enter when the surface has no entry to run", () => {
    expect(() =>
      byId("grid-edit-cell").run(makeContext(makeSurface({ enter: null })))
    ).not.toThrow();
  });
});
