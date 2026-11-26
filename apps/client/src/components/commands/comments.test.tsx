import { CommandRegistry } from "@/components/commands/provider";
import {
  COMMENTS_COMMANDS,
  COMPOSE_SCOPE,
} from "@/components/commands/comments";
import { useCommandScope } from "@/components/commands/provider";
import type { ActionContext } from "@/components/commands/types";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const STUB_CONTEXT = {} as ActionContext;

function press(key: string, options: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ...options }));
}

/** Pushes `COMPOSE_SCOPE` for as long as it renders, on `<textarea>` so a
 *  press through it exercises `allowInInput`. */
function Pusher({
  send,
  active = true,
}: {
  send: () => void;
  active?: boolean;
}) {
  useCommandScope(COMPOSE_SCOPE, { send }, active);
  return <textarea data-testid="composer" />;
}

afterEach(cleanup);

describe("COMMENTS_COMMANDS", () => {
  it("sends on mod+Enter while the compose scope is pushed", () => {
    const send = mock();
    render(
      <CommandRegistry commands={COMMENTS_COMMANDS} context={STUB_CONTEXT}>
        <Pusher send={send} />
      </CommandRegistry>
    );

    press("Enter", { metaKey: true });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing while no composer has pushed the scope", () => {
    const send = mock();
    render(
      <CommandRegistry commands={COMMENTS_COMMANDS} context={STUB_CONTEXT}>
        <Pusher send={send} active={false} />
      </CommandRegistry>
    );

    press("Enter", { metaKey: true });

    expect(send).not.toHaveBeenCalled();
  });

  it("fires from inside the textarea, since the key allows input targets", () => {
    const send = mock();
    const { getByTestId } = render(
      <CommandRegistry commands={COMMENTS_COMMANDS} context={STUB_CONTEXT}>
        <Pusher send={send} />
      </CommandRegistry>
    );

    const textarea = getByTestId("composer");
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        metaKey: true,
        bubbles: true,
      })
    );

    expect(send).toHaveBeenCalledTimes(1);
  });
});
