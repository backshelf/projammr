import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";

// `mock.module` is not hoisted: it must run before `./AppLink` is imported,
// since that import is what evaluates `next/link`.
let pending = false;

mock.module("next/link", () => ({
  __esModule: true,
  default: function StubLink({
    href,
    className,
    children,
    ...rest
  }: ComponentProps<"a"> & { href: unknown }) {
    return (
      <a
        href={typeof href === "string" ? href : JSON.stringify(href)}
        className={className}
        data-forwarded={JSON.stringify(rest)}
      >
        {children}
      </a>
    );
  },
  // Not a real hook, just a stub matching the shape `next/link` exports.
  useLinkStatus: () => ({ pending }),
}));

const { AppLink } = await import("./AppLink");

describe("AppLink", () => {
  it("forwards href and props to the link", () => {
    const html = renderToStaticMarkup(
      <AppLink
        href="/project/1/track/2"
        prefetch={false}
        scroll={false}
        aria-label="Track two"
      >
        Track two
      </AppLink>
    );

    expect(html).toContain('href="/project/1/track/2"');
    expect(html).toContain("link-pending");
    expect(html).toContain("Track two");
    const forwarded = JSON.parse(
      html.match(/data-forwarded="([^"]+)"/)![1]!.replace(/&quot;/g, '"')
    );
    expect(forwarded).toEqual({
      prefetch: false,
      scroll: false,
      "aria-label": "Track two",
    });
  });

  it("marks the link while pending and clears it after", () => {
    pending = true;
    const pendingHtml = renderToStaticMarkup(
      <AppLink href="/project/1">Project</AppLink>
    );
    expect(pendingHtml).toContain('data-pending=""');

    pending = false;
    const doneHtml = renderToStaticMarkup(
      <AppLink href="/project/1">Project</AppLink>
    );
    expect(doneHtml).not.toContain("data-pending");
  });

  it("defaults prefetch to false and lets callers opt back in", () => {
    const defaultHtml = renderToStaticMarkup(
      <AppLink href="/project/1">Project</AppLink>
    );
    const defaultForwarded = JSON.parse(
      defaultHtml.match(/data-forwarded="([^"]+)"/)![1]!.replace(/&quot;/g, '"')
    );
    expect(defaultForwarded.prefetch).toBe(false);

    const optInHtml = renderToStaticMarkup(
      <AppLink href="/project/1" prefetch>
        Project
      </AppLink>
    );
    const optInForwarded = JSON.parse(
      optInHtml.match(/data-forwarded="([^"]+)"/)![1]!.replace(/&quot;/g, '"')
    );
    expect(optInForwarded.prefetch).toBe(true);
  });
});
