import { cleanup, render } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import type { ComponentProps } from "react";

// `mock.module` is not hoisted: it must run before `HubShell` is imported,
// since that import is what evaluates `next/link`.
mock.module("next/link", () => ({
  __esModule: true,
  default: function StubLink({
    href,
    children,
    ...rest
  }: ComponentProps<"a"> & { href: unknown }) {
    return (
      <a href={String(href)} {...rest}>
        {children}
      </a>
    );
  },
  useLinkStatus: () => ({ pending: false }),
}));

mock.module("next/navigation", () => ({
  useRouter: () => ({ push: mock() }),
}));

const { HubShell } = await import("./HubShell");

// happy-dom starts on about:blank, where `history.replaceState` is ignored.
type HappyWindow = { happyDOM: { setURL(url: string): void } };
const happyDOM = (window as unknown as HappyWindow).happyDOM;
const START_URL = window.location.href;

const PLACE = { section: "devices" } as const;

function mount(page: ComponentProps<typeof HubShell>["children"]) {
  return render(
    <HubShell sections={[]} place={PLACE} index={[]}>
      {page}
    </HubShell>
  );
}

const machineRow = (id: string) => (
  <ul>
    <li id={`machine-${id}`} data-machine-row="" tabIndex={-1}>
      Studio Mac
    </li>
  </ul>
);

beforeEach(() => {
  jest.useFakeTimers();
  // Not implemented in happy-dom.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  happyDOM.setURL(START_URL);
});

describe("HubShell's anchor", () => {
  it("focuses and marks the machine row a #machine-<id> link names", () => {
    happyDOM.setURL("http://localhost/settings/devices#machine-abc");

    mount(machineRow("abc"));

    const row = document.getElementById("machine-abc")!;
    expect(document.activeElement).toBe(row);
    expect(row.hasAttribute("data-target")).toBe(true);
  });

  it("lets the mark go after a moment, keeping focus", () => {
    happyDOM.setURL("http://localhost/settings/devices#machine-abc");

    mount(machineRow("abc"));
    jest.advanceTimersByTime(2000);

    const row = document.getElementById("machine-abc")!;
    expect(row.hasAttribute("data-target")).toBe(false);
    expect(document.activeElement).toBe(row);
  });

  it("leaves focus alone when the hash names no machine on the page", () => {
    happyDOM.setURL("http://localhost/settings/devices#machine-gone");

    mount(machineRow("abc"));

    expect(document.activeElement).not.toBe(
      document.getElementById("machine-abc")
    );
  });

  it("leaves focus alone when the URL carries no hash", () => {
    happyDOM.setURL("http://localhost/settings/devices");

    mount(machineRow("abc"));

    expect(document.activeElement).not.toBe(
      document.getElementById("machine-abc")
    );
  });

  it("focuses and marks a machine row that streams in after mount", async () => {
    happyDOM.setURL("http://localhost/settings/devices#machine-abc");

    const { rerender } = mount(null);
    expect(document.getElementById("machine-abc")).toBeNull();

    rerender(
      <HubShell sections={[]} place={PLACE} index={[]}>
        {machineRow("abc")}
      </HubShell>
    );
    await Promise.resolve();

    const row = document.getElementById("machine-abc")!;
    expect(document.activeElement).toBe(row);
    expect(row.hasAttribute("data-target")).toBe(true);
  });

  it("moves focus and mark when hashchange targets another machine row", () => {
    happyDOM.setURL("http://localhost/settings/devices#machine-abc");

    mount(
      <ul>
        <li id="machine-abc" data-machine-row="" tabIndex={-1}>
          Studio Mac
        </li>
        <li id="machine-xyz" data-machine-row="" tabIndex={-1}>
          Laptop
        </li>
      </ul>
    );

    const first = document.getElementById("machine-abc")!;
    const second = document.getElementById("machine-xyz")!;
    expect(document.activeElement).toBe(first);

    happyDOM.setURL("http://localhost/settings/devices#machine-xyz");
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(document.activeElement).toBe(second);
    expect(second.hasAttribute("data-target")).toBe(true);
    expect(first.hasAttribute("data-target")).toBe(false);
  });
});
