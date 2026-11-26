import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { stubGlobal } from "@workspace/test/globals";

// The renderer reads WebGL's constants when it loads, so a browser without
// WebGL still has them; happy-dom does not. It makes no WebGL context either,
// as a browser without WebGL would not.
stubGlobal("WebGLRenderingContext", { FLOAT: 0x1406 });
stubGlobal("WebGL2RenderingContext", { FLOAT: 0x1406 });
const { Constellation } = await import("./constellation");

afterEach(cleanup);

describe("Constellation without WebGL", () => {
  it("says so in one line in the web's place, and draws nothing", () => {
    const { container, getByText } = render(
      <Constellation
        data={{ nodes: [], edges: [], key: "empty" }}
        label="Nothing yet"
      />
    );

    expect(getByText("Your browser can't draw the web.")).toBeTruthy();
    expect(container.querySelector("[role=img]")).toBeNull();
  });
});
