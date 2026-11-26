import { describe, expect, it } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type PatchCable,
  type PatchNode,
  type PatchbayOptions,
  layoutPatchbay,
} from "@workspace/ui/lib/patchbay";
import { Patchbay } from "./patchbay";

const sets: PatchNode[] = [
  { id: "s1", label: "Anthem", meta: "Track one", href: "/session/1" },
  { id: "s2", label: "Ballad" },
  { id: "s3", label: "Coda" },
];

const samples: PatchNode[] = [
  { id: "kick.wav", label: "kick.wav", meta: "Drums" },
  { id: "gone.wav", label: "gone.wav", missing: true },
  { id: "solo.wav", label: "solo.wav" },
];

const cables: PatchCable[] = [
  { left: "s1", right: "kick.wav" },
  { left: "s2", right: "kick.wav" },
  { left: "s2", right: "gone.wav" },
  { left: "s3", right: "gone.wav" },
  { left: "s1", right: "solo.wav" },
];

function render(options: PatchbayOptions = {}): HTMLElement {
  const html = renderToStaticMarkup(
    <Patchbay
      layout={layoutPatchbay(sets, samples, cables, options)}
      leftHead="Sets"
      rightHead="Samples"
      summary="3 sets share 2 samples."
    />
  );
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}

describe("Patchbay", () => {
  it("indexes every node by id and side, in row order within its rail", () => {
    const host = render();

    const left = [...host.querySelectorAll('[data-pb-rail="left"] > li')];
    const right = [...host.querySelectorAll('[data-pb-rail="right"] > li')];
    expect(left.map((li) => li.getAttribute("data-pb-node"))).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
    expect(right.map((li) => li.getAttribute("data-pb-node"))).toEqual([
      "kick.wav",
      "gone.wav",
    ]);
    expect(left.every((li) => li.getAttribute("data-pb-side") === "left")).toBe(
      true
    );
    expect(
      right.every((li) => li.getAttribute("data-pb-side") === "right")
    ).toBe(true);
  });

  it("draws one cable per use, named by its two ends, from row centre to row centre", () => {
    const host = render();

    const paths = [...host.querySelectorAll("path[data-pb-cable]")];
    expect(paths.map((p) => p.getAttribute("data-pb-cable"))).toEqual([
      "s1|kick.wav",
      "s2|kick.wav",
      "s2|gone.wav",
      "s3|gone.wav",
    ]);
    // Row 1 of the left rail (centre 36px) to row 1 of the right (36px).
    expect(paths[2]?.getAttribute("d")).toBe("M0 36 C50 36 50 36 100 36");
    expect(paths[0]?.getAttribute("vector-effect")).toBe("non-scaling-stroke");

    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("none");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 100 72");
  });

  it("draws a missing node hollow and dashes its cables", () => {
    const host = render();

    const gone = host.querySelector('[data-pb-node="gone.wav"]');
    expect(gone?.hasAttribute("data-missing")).toBe(true);
    expect(gone?.querySelector("i")?.className).toContain("border");
    expect(gone?.textContent).toContain("missing");
    expect(
      host.querySelector('[data-pb-node="kick.wav"] i')?.className
    ).toContain("bg-ink-soft");

    const dashed = [...host.querySelectorAll("path[stroke-dasharray]")];
    expect(dashed.map((p) => p.getAttribute("data-pb-cable"))).toEqual([
      "s2|gone.wav",
      "s3|gone.wav",
    ]);
  });

  it("names the cable drawing with the summary and keeps each label as text", () => {
    const host = render();

    const svg = host.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("3 sets share 2 samples.");
    expect(host.querySelector("[role=img] a")).toBeNull();

    const link = host.querySelector('[data-pb-node="s1"] a');
    expect(link?.getAttribute("href")).toBe("/session/1");
    expect(link?.textContent).toBe("Anthem");
    expect(host.querySelector('[data-pb-node="s2"] a')).toBeNull();
    expect(host.querySelector('[data-pb-node="s2"]')?.textContent).toBe(
      "Ballad"
    );
  });

  it("links a node out through the link component it is given", () => {
    function RouterLink({
      href,
      className,
      children,
    }: {
      href: string;
      className?: string;
      children?: ReactNode;
    }) {
      return (
        <a href={href} className={className} data-router="">
          {children}
        </a>
      );
    }
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(
      <Patchbay
        layout={layoutPatchbay(sets, samples, cables)}
        leftHead="Sets"
        rightHead="Samples"
        summary="3 sets share 2 samples."
        link={RouterLink}
      />
    );

    const link = host.querySelector('[data-pb-node="s1"] a');
    expect(link?.hasAttribute("data-router")).toBe(true);
    expect(link?.getAttribute("href")).toBe("/session/1");
    expect(link?.querySelector("[data-pb-label]")?.textContent).toBe("Anthem");
  });

  it("shows a set's single-use samples as its own count, with its meta", () => {
    const host = render();

    const anthem = host.querySelector('[data-pb-node="s1"]');
    expect(anthem?.textContent).toContain("Track one");
    expect(anthem?.textContent).toContain("+1 own");
    expect(host.querySelector('[data-pb-node="solo.wav"]')).toBeNull();
  });

  it("ends each capped rail in a count of what was cut, at the one row height", () => {
    const host = render({ maxLeft: 1, maxRight: 1 });

    const root = host.querySelector<HTMLElement>("[data-pb-root]");
    expect(root?.style.getPropertyValue("--pb-row")).toBe("24px");
    const feet = [...host.querySelectorAll("p")].map((p) => p.textContent);
    expect(feet).toEqual(["+2 more", "+1 more"]);
    expect(host.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 100 24"
    );
  });

  it("draws both rails and no cables when nothing is patched", () => {
    const html = renderToStaticMarkup(
      <Patchbay
        layout={layoutPatchbay(sets, samples, [])}
        leftHead="Sets"
        rightHead="Samples"
        summary="No shared samples."
      />
    );

    expect(html.match(/data-pb-node=/g)).toHaveLength(6);
    expect(html).not.toContain("<path");
    expect(html).not.toContain("more");
  });
});
