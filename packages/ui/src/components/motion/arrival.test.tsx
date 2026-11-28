import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { PageHead } from "@workspace/ui/components/layout/page-head";
import { m } from "@workspace/ui/lib/motion";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { MotionGlobalConfig } from "motion/react";
import { Activity } from "react";
import {
  arrivalVariants,
  ArrivalRoot,
  useArrival,
  useArrivalSettled,
} from "./arrival";

const previousSkip = MotionGlobalConfig.skipAnimations;

afterEach(() => {
  cleanup();
  MotionGlobalConfig.skipAnimations = previousSkip;
  document.documentElement.removeAttribute("data-motion");
});

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

  it("starts settled when reduced motion is enabled so headings never render hidden", () => {
    document.documentElement.setAttribute("data-motion", "reduce");
    render(
      <MotionProvider>
        <PageHead title="Personal" lede="Your preferences" />
      </MotionProvider>
    );

    expect(screen.getByText("Personal").style.opacity).toBe("1");
  });

  it("settles cleanly when hidden and revealed inside React <Activity>", async () => {
    MotionGlobalConfig.skipAnimations = false;
    const { rerender } = render(
      <MotionProvider>
        <Activity mode="hidden">
          <PageHead title="Personal" lede="Your preferences" />
        </Activity>
      </MotionProvider>
    );

    await act(async () => {
      rerender(
        <MotionProvider>
          <Activity mode="visible">
            <PageHead title="Personal" lede="Your preferences" />
          </Activity>
        </MotionProvider>
      );
    });

    await waitFor(
      () => {
        expect(screen.getByText("Personal").style.opacity).toBe("1");
      },
      { timeout: 2000 }
    );
  });

  it("settles arrival state when Activity toggles visible -> hidden -> visible", async () => {
    function SettledProbe() {
      const settled = useArrivalSettled();
      return <span data-testid="settled">{String(settled)}</span>;
    }

    const { rerender } = render(
      <MotionProvider>
        <Activity mode="visible">
          <ArrivalRoot kind="load">
            <SettledProbe />
          </ArrivalRoot>
        </Activity>
      </MotionProvider>
    );

    await act(async () => {
      rerender(
        <MotionProvider>
          <Activity mode="hidden">
            <ArrivalRoot kind="load">
              <SettledProbe />
            </ArrivalRoot>
          </Activity>
        </MotionProvider>
      );
    });

    await new Promise((resolve) => setTimeout(resolve, 40));

    await act(async () => {
      rerender(
        <MotionProvider>
          <Activity mode="visible">
            <ArrivalRoot kind="load">
              <SettledProbe />
            </ArrivalRoot>
          </Activity>
        </MotionProvider>
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("settled").textContent).toBe("true");
    });
  });
});
