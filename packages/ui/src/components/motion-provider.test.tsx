import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { useReducedMotion } from "@workspace/ui/lib/motion";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import {
  MotionConfigContext,
  useReducedMotion as useSystemReducedMotion,
} from "motion/react";
import { use } from "react";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-motion");
});

/** Reports what Motion was configured with, what the shared hook answers, and
 *  what the OS alone says, for the three to be compared. */
function Probe() {
  const { reducedMotion } = use(MotionConfigContext);
  const reduced = useReducedMotion();
  const system = useSystemReducedMotion();
  return (
    <output
      data-testid={"probe"}
      data-config={reducedMotion}
      data-reduced={String(reduced)}
      data-system={String(system)}
    />
  );
}

const renderProbe = () => {
  render(
    <MotionProvider>
      <Probe />
    </MotionProvider>
  );
  return screen.getByTestId("probe");
};

describe("MotionProvider", () => {
  it("follows the OS when <html> carries no data-motion", () => {
    const probe = renderProbe();
    expect(probe.dataset.config).toBe("user");
    expect(probe.dataset.reduced).toBe(probe.dataset.system);
  });

  it("follows the OS for data-motion=system", () => {
    document.documentElement.dataset.motion = "system";
    const probe = renderProbe();
    expect(probe.dataset.config).toBe("user");
    expect(probe.dataset.reduced).toBe(probe.dataset.system);
  });

  it("reduces motion for data-motion=reduce, whatever the OS says", () => {
    document.documentElement.dataset.motion = "reduce";
    const probe = renderProbe();
    expect(probe.dataset.config).toBe("always");
    expect(probe.dataset.reduced).toBe("true");
  });

  it("runs motion for data-motion=full, whatever the OS says", () => {
    document.documentElement.dataset.motion = "full";
    const probe = renderProbe();
    expect(probe.dataset.config).toBe("never");
    expect(probe.dataset.reduced).toBe("false");
  });

  it("treats a value outside the three as system", () => {
    document.documentElement.dataset.motion = "sometimes";
    const probe = renderProbe();
    expect(probe.dataset.config).toBe("user");
    expect(probe.dataset.reduced).toBe(probe.dataset.system);
  });

  it("follows the attribute when it changes after mount", async () => {
    const probe = renderProbe();
    expect(probe.dataset.config).toBe("user");

    act(() => {
      document.documentElement.dataset.motion = "reduce";
    });
    await waitFor(() => expect(probe.dataset.config).toBe("always"));
    expect(probe.dataset.reduced).toBe("true");

    act(() => {
      document.documentElement.dataset.motion = "full";
    });
    await waitFor(() => expect(probe.dataset.config).toBe("never"));
    expect(probe.dataset.reduced).toBe("false");

    act(() => {
      document.documentElement.removeAttribute("data-motion");
    });
    await waitFor(() => expect(probe.dataset.config).toBe("user"));
  });
});
