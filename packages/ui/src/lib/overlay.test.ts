import { describe, expect, it } from "bun:test";
import { createElement, type ReactElement, type ReactNode } from "react";
import { composeRender } from "./overlay";

type Props = { render?: ReactElement; children?: ReactNode };

describe("composeRender", () => {
  const child = createElement("a", { href: "/x" }, "Go");

  it("hands an asChild child to render", () => {
    const composed = composeRender<Props>({ asChild: true, children: child });

    expect(composed.render).toBe(child);
    expect(composed.children).toBeUndefined();
    expect("asChild" in composed).toBe(false);
  });

  it("leaves children alone without asChild", () => {
    const composed = composeRender<Props>({ children: "Open" });

    expect(composed.children).toBe("Open");
    expect(composed.render).toBeUndefined();
  });

  it("prefers an explicit render over asChild", () => {
    const render = createElement("button");
    const composed = composeRender<Props>({
      asChild: true,
      render,
      children: child,
    });

    expect(composed.render).toBe(render);
    expect(composed.children).toBe(child);
  });
});
