import { defineCommands } from "@/components/commands/define";
import {
  ENTITY_COMMANDS,
  ENTITY_SCOPE,
  type EntityKeyName,
} from "@/components/commands/entity";
import {
  EntitySurfaceProvider,
  useEntityKey,
} from "@/components/commands/entity-surface";
import { CommandRegistry, useCommands } from "@/components/commands/provider";
import type { ActionContext } from "@/components/commands/types";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ReactNode } from "react";

/** A stand-in for what W7's commands do: run the handler a control registered. */
const RUN_RENAME = defineCommands(ENTITY_SCOPE, [
  {
    id: "test-run-rename",
    label: "Run rename",
    group: "Track",
    keys: ["z"],
    run: (ctx) => ctx.surface.handler("rename")?.(),
  },
]);

const push = mock();
const CONTEXT = { router: { push } } as unknown as ActionContext;

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  });
}

function Control({ name, fn }: { name: EntityKeyName; fn: () => void }) {
  useEntityKey(name, fn);
  return null;
}

function EnabledControl({ fn, enabled }: { fn: () => void; enabled: boolean }) {
  useEntityKey("rename", fn, enabled);
  return null;
}

function TrackPage({
  children,
  previousHref = null,
  nextHref = null,
}: {
  children?: ReactNode;
  previousHref?: string | null;
  nextHref?: string | null;
}) {
  return (
    <CommandRegistry
      commands={[...ENTITY_COMMANDS, ...RUN_RENAME]}
      context={CONTEXT}
    >
      <EntitySurfaceProvider previousHref={previousHref} nextHref={nextHref}>
        {children}
      </EntitySurfaceProvider>
    </CommandRegistry>
  );
}

afterEach(() => {
  cleanup();
  push.mockReset();
});

describe("useEntityKey", () => {
  it("is a no-op where no entity provider is mounted", () => {
    const fn = mock();
    expect(() => renderHook(() => useEntityKey("rename", fn))).not.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it("is a no-op inside a registry without the entity provider", () => {
    const fn = mock();
    render(
      <CommandRegistry commands={RUN_RENAME} context={CONTEXT}>
        <Control name="rename" fn={fn} />
      </CommandRegistry>
    );
    press("z");
    expect(fn).not.toHaveBeenCalled();
  });

  it("makes a mounted control's handler what the entity keys run", () => {
    const fn = mock();
    render(
      <TrackPage>
        <Control name="rename" fn={fn} />
      </TrackPage>
    );
    press("z");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("registers nothing while disabled, and registers once enabled", () => {
    const fn = mock();
    const page = (enabled: boolean) => (
      <TrackPage>
        <EnabledControl fn={fn} enabled={enabled} />
      </TrackPage>
    );
    const { rerender } = render(page(false));
    press("z");
    expect(fn).not.toHaveBeenCalled();

    rerender(page(true));
    press("z");
    expect(fn).toHaveBeenCalledTimes(1);

    rerender(page(false));
    press("z");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("lists a key as available the moment its handler registers or goes", () => {
    function Listed() {
      const rename = useCommands().find(
        (command) => command.id === "rename-track"
      );
      return <output data-testid="rename">{String(rename?.available)}</output>;
    }
    const available = () => screen.getByTestId("rename").textContent;
    const page = (enabled: boolean) => (
      <TrackPage>
        <Listed />
        <EnabledControl fn={mock()} enabled={enabled} />
      </TrackPage>
    );
    const { rerender } = render(page(false));
    expect(available()).toBe("false");

    rerender(page(true));
    expect(available()).toBe("true");

    rerender(page(false));
    expect(available()).toBe("false");
  });

  it("runs the latest closure a control passed", () => {
    const first = mock();
    const second = mock();
    const { rerender } = render(
      <TrackPage>
        <Control name="rename" fn={first} />
      </TrackPage>
    );
    rerender(
      <TrackPage>
        <Control name="rename" fn={second} />
      </TrackPage>
    );
    press("z");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("stops running a control's handler once it unmounts", () => {
    const fn = mock();
    const { rerender } = render(
      <TrackPage>
        <Control name="rename" fn={fn} />
      </TrackPage>
    );
    rerender(<TrackPage />);
    press("z");
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("EntitySurfaceProvider", () => {
  it("pushes the entity scope with the running order's hrefs while mounted", () => {
    render(<TrackPage previousHref="/prev" nextHref="/next" />);
    press("{");
    press("}");
    expect(push.mock.calls).toEqual([["/prev"], ["/next"]]);
  });

  it("leaves `{` and `}` dead when the page has no neighbours", () => {
    render(<TrackPage />);
    press("{");
    press("}");
    expect(push).not.toHaveBeenCalled();
  });

  it("withdraws the scope when the page unmounts", () => {
    const page = (mounted: boolean) => (
      <CommandRegistry commands={ENTITY_COMMANDS} context={CONTEXT}>
        {mounted && (
          <EntitySurfaceProvider previousHref="/prev" nextHref="/next">
            {null}
          </EntitySurfaceProvider>
        )}
      </CommandRegistry>
    );
    const { rerender } = render(page(true));
    press("{");
    expect(push).toHaveBeenCalledTimes(1);

    rerender(page(false));
    press("{");
    expect(push).toHaveBeenCalledTimes(1);
  });
});
