import { COMMENTS_COMMANDS } from "@/components/commands/comments";
import { CommandRegistry } from "@/components/commands/provider";
import type { ActionContext } from "@/components/commands/types";
import { useComposeKey } from "@/components/comments/use-compose-key";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const STUB_CONTEXT = {} as ActionContext;

function Composer({ send }: { send: () => void }) {
  const { focusProps, onKeyDown } = useComposeKey(send);
  return (
    <div {...focusProps}>
      <textarea data-testid="composer" onKeyDown={onKeyDown} />
    </div>
  );
}

afterEach(cleanup);

describe("useComposeKey", () => {
  it("sends on mod+Enter by itself where no registry is mounted (a share page)", () => {
    const send = mock();
    render(<Composer send={send} />);

    fireEvent.keyDown(screen.getByTestId("composer"), {
      key: "Enter",
      metaKey: true,
    });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends once, through the registry, inside the signed-in app", () => {
    const send = mock();
    render(
      <CommandRegistry commands={COMMENTS_COMMANDS} context={STUB_CONTEXT}>
        <Composer send={send} />
      </CommandRegistry>
    );
    const composer = screen.getByTestId("composer");
    fireEvent.focus(composer);

    fireEvent.keyDown(composer, { key: "Enter", metaKey: true });

    expect(send).toHaveBeenCalledTimes(1);
  });
});
