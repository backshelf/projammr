import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { useRevealOpenRow } from "./use-reveal-open-row";

const scrollIntoView = mock<(options?: ScrollIntoViewOptions) => void>();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
});

afterEach(cleanup);

/** Where the open row sits on screen, as the browser would measure it. */
let rowTop = 0;

function List({ open }: { open?: string }) {
  const ref = useRevealOpenRow<HTMLDivElement>(open);
  return (
    <div ref={ref}>
      {["a", "b"].map((id) => (
        <div
          key={id}
          aria-current={open === id ? "true" : undefined}
          ref={(element) => {
            if (element)
              element.getBoundingClientRect = () =>
                ({ top: rowTop, bottom: rowTop + 40 }) as DOMRect;
          }}
        >
          {id}
        </div>
      ))}
    </div>
  );
}

describe("useRevealOpenRow", () => {
  test("brings a row opened out of view to the middle of the window", () => {
    rowTop = window.innerHeight + 200;
    const { rerender } = render(<List />);

    rerender(<List open="b" />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "smooth",
    });
    expect((scrollIntoView.mock.contexts[0] as Element).textContent).toBe("b");
  });

  test("leaves a row that opened in view where it is", () => {
    rowTop = 100;
    const { rerender } = render(<List />);

    rerender(<List open="a" />);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  test("does nothing while no row is open", () => {
    rowTop = window.innerHeight + 200;
    render(<List />);

    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
