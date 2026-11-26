import { Arrive } from "@workspace/ui/components/layout/arrive";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";

afterEach(cleanup);

const sessions = (
  <MotionProvider>
    <Arrive>
      <p>{"four sessions"}</p>
    </Arrive>
  </MotionProvider>
);

/** The page as the server sent it, taken over by the client — the pass in
 *  which streamed content is part of the paint rather than arriving over it. */
async function hydrate() {
  const container = document.createElement("div");
  container.innerHTML = renderToString(sessions);
  document.body.append(container);
  const root = await act(async () => hydrateRoot(container, sessions));
  return {
    arrived: container.firstElementChild as HTMLElement,
    unmount: () => act(() => root.unmount()),
  };
}

describe("Arrive", () => {
  it("fades content that mounts after the page in", () => {
    const { container } = render(sessions);

    expect((container.firstElementChild as HTMLElement).style.opacity).toBe(
      "0"
    );
  });

  it("leaves content that was part of the first paint alone", async () => {
    const { arrived, unmount } = await hydrate();

    expect(arrived.getAttribute("style")).toBeNull();
    expect(arrived.textContent).toBe("four sessions");

    await unmount();
  });
});
