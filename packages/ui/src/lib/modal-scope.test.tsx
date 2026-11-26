import { render, renderHook } from "@testing-library/react";
import { describe, expect, it, mock } from "bun:test";
import { useEffect, type ReactNode } from "react";
import {
  ModalScopeProvider,
  useModalScope,
  type ModalSurface,
} from "./modal-scope";

function providerWith(push: (surface: ModalSurface) => () => void) {
  return function wrapper({ children }: { children: ReactNode }) {
    return <ModalScopeProvider push={push}>{children}</ModalScopeProvider>;
  };
}

describe("useModalScope", () => {
  it("does nothing without a ModalScopeProvider", () => {
    expect(() =>
      renderHook(() => useModalScope(true, { confirm: () => {} }))
    ).not.toThrow();
  });

  it("pushes once the dialog opens and releases once it closes", () => {
    const release = mock();
    const push = mock<(surface: ModalSurface) => () => void>(() => release);

    const { rerender } = renderHook(({ open }) => useModalScope(open), {
      initialProps: { open: false },
      wrapper: providerWith(push),
    });
    expect(push).not.toHaveBeenCalled();

    rerender({ open: true });
    expect(push).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    rerender({ open: false });
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases on unmount", () => {
    const release = mock();
    const push = mock<(surface: ModalSurface) => () => void>(() => release);

    const { unmount } = renderHook(() => useModalScope(true), {
      wrapper: providerWith(push),
    });
    expect(push).toHaveBeenCalledTimes(1);

    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("reads the latest confirm through the pushed surface, without re-pushing", () => {
    let pushed: ModalSurface | undefined;
    const push = mock((surface: ModalSurface) => {
      pushed = surface;
      return () => {};
    });

    const first = mock();
    const second = mock();
    const { rerender } = renderHook(
      ({ confirm }: { confirm: () => void }) =>
        useModalScope(true, { confirm }),
      { initialProps: { confirm: first }, wrapper: providerWith(push) }
    );
    expect(push).toHaveBeenCalledTimes(1);

    rerender({ confirm: second });
    expect(push).toHaveBeenCalledTimes(1);

    pushed?.confirm?.();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("pushes before an effect its own children run in the same commit", () => {
    const order: string[] = [];
    const push = mock<(surface: ModalSurface) => () => void>(() => {
      order.push("modal");
      return () => {};
    });

    function Child() {
      useEffect(() => {
        order.push("child");
      }, []);
      return null;
    }
    function Overlay() {
      useModalScope(true);
      return <Child />;
    }

    render(<Overlay />, { wrapper: providerWith(push) });

    expect(order).toEqual(["modal", "child"]);
  });
});
