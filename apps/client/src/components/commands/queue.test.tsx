import {
  CommandRegistry,
  useCommandScope,
} from "@/components/commands/provider";
import {
  QUEUE_COMMANDS,
  QUEUE_SCOPE,
  type QueueSurface,
} from "@/components/commands/queue";
import type { ActionContext } from "@/components/commands/types";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const nowPlaying = (open: boolean, view: string) => ({
  open,
  view,
  setOpen: mock(),
  setView: mock(),
});

function makeContext(np: ReturnType<typeof nowPlaying>): ActionContext {
  return { nowPlaying: np } as unknown as ActionContext;
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

function Pusher({ surface }: { surface: QueueSurface }) {
  useCommandScope(QUEUE_SCOPE, surface, true);
  return null;
}

afterEach(cleanup);

describe("show-queue", () => {
  it("opens the sheet on its queue view on q", () => {
    const np = nowPlaying(false, "player");
    render(
      <CommandRegistry commands={QUEUE_COMMANDS} context={makeContext(np)}>
        <div />
      </CommandRegistry>
    );
    press("q");
    expect(np.setView).toHaveBeenCalledWith("queue");
    expect(np.setOpen).toHaveBeenCalledWith(true);
  });

  it("switches an open sheet on another view to the queue", () => {
    const np = nowPlaying(true, "player");
    render(
      <CommandRegistry commands={QUEUE_COMMANDS} context={makeContext(np)}>
        <div />
      </CommandRegistry>
    );
    press("q");
    expect(np.setView).toHaveBeenCalledWith("queue");
    expect(np.setOpen).toHaveBeenCalledWith(true);
  });

  it("closes the sheet on q while it shows the queue", () => {
    const np = nowPlaying(true, "queue");
    render(
      <CommandRegistry commands={QUEUE_COMMANDS} context={makeContext(np)}>
        <div />
      </CommandRegistry>
    );
    press("q");
    expect(np.setOpen).toHaveBeenCalledWith(false);
    expect(np.setView).not.toHaveBeenCalled();
  });
});

describe("queue scope", () => {
  const surface = () => ({
    next: mock(),
    previous: mock(),
    remove: mock(),
    jump: mock(),
  });

  it("runs the surface's action for each key", () => {
    const s = surface();
    render(
      <CommandRegistry
        commands={QUEUE_COMMANDS}
        context={makeContext(nowPlaying(false, "player"))}
      >
        <Pusher surface={s} />
      </CommandRegistry>
    );
    press("j");
    press("k");
    press("x");
    press("Enter");
    expect(s.next).toHaveBeenCalledTimes(1);
    expect(s.previous).toHaveBeenCalledTimes(1);
    expect(s.remove).toHaveBeenCalledTimes(1);
    expect(s.jump).toHaveBeenCalledTimes(1);
  });

  it("hides a command whose action is null", () => {
    const s = surface();
    render(
      <CommandRegistry
        commands={QUEUE_COMMANDS}
        context={makeContext(nowPlaying(false, "player"))}
      >
        <Pusher
          surface={{ next: null, previous: null, remove: null, jump: null }}
        />
      </CommandRegistry>
    );
    press("j");
    press("x");
    expect(s.next).not.toHaveBeenCalled();
    expect(s.remove).not.toHaveBeenCalled();
  });
});
