import { COMMANDS } from "@/components/commands";
import {
  NOTE_SCOPE,
  NOTEBOOK_COMMANDS,
  NOTEBOOK_SCOPE,
  type NotebookSurface,
  type NoteSurface,
} from "@/components/commands/notebook";
import type { Command, CommandContext } from "@/components/commands/types";
import { describe, expect, it, mock } from "bun:test";

function command(id: string): Command {
  const found = NOTEBOOK_COMMANDS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no command ${id}`);
  return found;
}

function ctx(surface: NotebookSurface | NoteSurface): CommandContext {
  return { surface, count: 1 } as unknown as CommandContext;
}

describe("NOTEBOOK_COMMANDS", () => {
  it("binds the list's keys to the notebook scope and the editor's to the note scope", () => {
    const keyed = (id: string) => [command(id).scope, command(id).keys];

    expect(keyed("next-note")).toEqual([NOTEBOOK_SCOPE.name, ["j"]]);
    expect(keyed("previous-note")).toEqual([NOTEBOOK_SCOPE.name, ["k"]]);
    expect(keyed("focus-note-filter")).toEqual([NOTEBOOK_SCOPE.name, ["f"]]);
    expect(keyed("copy-note")).toEqual([NOTE_SCOPE.name, ["y"]]);
    expect(keyed("link-note")).toEqual([NOTE_SCOPE.name, ["t"]]);
  });

  it("is part of the app's command list", () => {
    for (const { id } of NOTEBOOK_COMMANDS) {
      expect(COMMANDS.some((candidate) => candidate.id === id)).toBe(true);
    }
  });

  it("steps forward and back through the list", () => {
    const step = mock();
    const surface = { step, focusFilter: null };

    command("next-note").run(ctx(surface));
    command("previous-note").run(ctx(surface));

    expect(step.mock.calls).toEqual([[1], [-1]]);
  });

  it("hides j and k when the list has no notes to step through", () => {
    const surface = { step: null, focusFilter: null };

    expect(command("next-note").when?.(ctx(surface))).toBe(false);
    expect(command("previous-note").when?.(ctx(surface))).toBe(false);
  });

  it("hides f when there is no filter to focus", () => {
    expect(
      command("focus-note-filter").when?.(
        ctx({ step: null, focusFilter: null })
      )
    ).toBe(false);
  });

  it("hides t where the note's rights do not allow linking", () => {
    const link = mock();

    expect(command("link-note").when?.(ctx({ copy: null, link: null }))).toBe(
      false
    );
    expect(command("link-note").when?.(ctx({ copy: null, link }))).toBe(true);
  });

  it("runs the editor's copy and link", () => {
    const copy = mock();
    const link = mock();

    command("copy-note").run(ctx({ copy, link }));
    command("link-note").run(ctx({ copy, link }));

    expect(copy).toHaveBeenCalledTimes(1);
    expect(link).toHaveBeenCalledTimes(1);
  });

  it("is not repeatable", () => {
    expect(NOTEBOOK_COMMANDS.some((candidate) => candidate.repeatable)).toBe(
      false
    );
  });
});
