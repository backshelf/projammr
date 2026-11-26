import { CommandRegistry } from "@/components/commands/provider";
import { PEEK_COMMANDS, PEEK_SCOPE } from "@/components/commands/peek";
import { PLAYER_COMMANDS } from "@/components/commands/player";
import { useCommandScope } from "@/components/commands/provider";
import type { ActionContext } from "@/components/commands/types";
import { DEFAULT_PLAYBACK } from "@/lib/policies/playback";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

function makeContext(overrides: Record<string, unknown> = {}): ActionContext {
  return {
    player: { getSnapshot: () => ({ current: null, duration: 0 }) },
    playerActions: { seek: mock() },
    playback: DEFAULT_PLAYBACK,
    ...overrides,
  } as unknown as ActionContext;
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

/** Pushes `PEEK_SCOPE` for as long as it renders. */
function Pusher({
  previous,
  next,
  nextLoading,
}: {
  previous?: () => void;
  next?: () => void;
  nextLoading: boolean;
}) {
  useCommandScope(PEEK_SCOPE, { previous, next, nextLoading }, true);
  return null;
}

afterEach(cleanup);

describe("PEEK_COMMANDS", () => {
  const previous = mock();
  const next = mock();

  afterEach(() => {
    previous.mockClear();
    next.mockClear();
  });

  it("steps to the previous row on ArrowLeft when a previous step is offered", () => {
    render(
      <CommandRegistry commands={PEEK_COMMANDS} context={makeContext()}>
        <Pusher previous={previous} next={next} nextLoading={false} />
      </CommandRegistry>
    );

    press("ArrowLeft");
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("steps to the next row on ArrowRight when a next step is offered and not loading", () => {
    render(
      <CommandRegistry commands={PEEK_COMMANDS} context={makeContext()}>
        <Pusher previous={previous} next={next} nextLoading={false} />
      </CommandRegistry>
    );

    press("ArrowRight");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("steps to the previous row on k and the next row on j", () => {
    render(
      <CommandRegistry commands={PEEK_COMMANDS} context={makeContext()}>
        <Pusher previous={previous} next={next} nextLoading={false} />
      </CommandRegistry>
    );

    press("k");
    expect(previous).toHaveBeenCalledTimes(1);
    press("j");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does nothing on j while the next step is loading", () => {
    render(
      <CommandRegistry commands={PEEK_COMMANDS} context={makeContext()}>
        <Pusher previous={previous} next={next} nextLoading />
      </CommandRegistry>
    );

    press("j");
    expect(next).not.toHaveBeenCalled();
  });

  it("does nothing on ArrowRight while the next step is loading", () => {
    render(
      <CommandRegistry commands={PEEK_COMMANDS} context={makeContext()}>
        <Pusher previous={previous} next={next} nextLoading />
      </CommandRegistry>
    );

    press("ArrowRight");
    expect(next).not.toHaveBeenCalled();
  });

  it("does nothing on an end with no step in that direction", () => {
    render(
      <CommandRegistry commands={PEEK_COMMANDS} context={makeContext()}>
        <Pusher previous={undefined} next={next} nextLoading={false} />
      </CommandRegistry>
    );

    press("ArrowLeft");
    expect(previous).not.toHaveBeenCalled();
  });
});

describe("peek precedence over the player's seek arrows", () => {
  it("steps the row, not the player, while the peek is pushed over the global scope", () => {
    const seek = mock();
    const context = makeContext({
      player: {
        getSnapshot: () => ({ current: { id: 1 }, duration: 100 }),
        getProgress: () => 10,
      },
      playerActions: { seek },
    });
    const next = mock();

    render(
      <CommandRegistry
        commands={[...PLAYER_COMMANDS, ...PEEK_COMMANDS]}
        context={context}
      >
        <Pusher previous={undefined} next={next} nextLoading={false} />
      </CommandRegistry>
    );

    press("ArrowRight");

    expect(next).toHaveBeenCalledTimes(1);
    expect(seek).not.toHaveBeenCalled();
  });

  it("falls back to the player's seek once the peek is no longer pushed", () => {
    const seek = mock();
    const context = makeContext({
      player: {
        getSnapshot: () => ({ current: { id: 1 }, duration: 100 }),
        getProgress: () => 10,
      },
      playerActions: { seek },
    });

    const { rerender } = render(
      <CommandRegistry
        commands={[...PLAYER_COMMANDS, ...PEEK_COMMANDS]}
        context={context}
      >
        <Pusher previous={undefined} next={mock()} nextLoading={false} />
      </CommandRegistry>
    );

    rerender(
      <CommandRegistry
        commands={[...PLAYER_COMMANDS, ...PEEK_COMMANDS]}
        context={context}
      >
        {null}
      </CommandRegistry>
    );

    press("ArrowRight");
    expect(seek).toHaveBeenCalledTimes(1);
  });
});
