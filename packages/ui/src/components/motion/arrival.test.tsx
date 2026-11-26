import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { m } from "@workspace/ui/lib/motion";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { arrivalVariants, ArrivalRoot, useArrival } from "./arrival";

afterEach(cleanup);

/** A part nested below the root, as the real ones are below server components.
 *  It declares no `initial` of its own, so what it renders at is whatever the
 *  root's variant context gives it. */
function Part() {
  return (
    <div>
      <m.div variants={arrivalVariants("load", "title")} data-testid={"part"}>
        Rumours
      </m.div>
    </div>
  );
}

const renderArrival = () =>
  render(
    <MotionProvider>
      <ArrivalRoot kind={"load"}>
        <Part />
      </ArrivalRoot>
    </MotionProvider>
  );

/** A real part: it spreads the hook's props, as the masthead's parts do. */
function HookedPart({ seen }: { seen: (initial: false | undefined) => void }) {
  const arrival = useArrival("eyebrow");
  seen(arrival.initial);
  return (
    <m.div {...arrival} data-testid={"hooked"}>
      Dreams
    </m.div>
  );
}

describe("useArrival", () => {
  it("never sets a variant label as a part's initial, so the part inherits the root's animate", async () => {
    const initials: (false | undefined)[] = [];
    render(
      <MotionProvider>
        <ArrivalRoot kind={"load"}>
          <HookedPart seen={(initial) => initials.push(initial)} />
        </ArrivalRoot>
      </MotionProvider>
    );

    // Inherited from the root while the entrance runs: hidden, not at rest.
    expect(initials[0]).toBeUndefined();
    expect(screen.getByTestId("hooked").style.opacity).toBe("0");
    // In place once the entrance has settled.
    await waitFor(() => expect(initials.at(-1)).toBe(false));
  });
});

describe("ArrivalRoot", () => {
  it("drives the variants of a part below it", () => {
    renderArrival();
    expect(screen.getByTestId("part").style.opacity).toBe("0");
  });

  it("carries its kind while the entrance runs and drops it after", async () => {
    const { container } = renderArrival();
    const root = container.firstElementChild;

    expect(root?.getAttribute("data-arrival")).toBe("load");
    await waitFor(() => expect(root?.hasAttribute("data-arrival")).toBe(false));
  });
});
