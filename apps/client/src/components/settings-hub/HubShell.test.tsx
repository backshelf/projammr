import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { SETTINGS } from "@workspace/settings";
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

const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");
const { HubRowsProvider } = await import("./hub-rows");
const { HubShell } = await import("./HubShell");
const { hubLayout } = await import("./layout");

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
  // Not implemented in happy-dom.
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  happyDOM.setURL(START_URL);
});

describe("HubShell's anchor", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });
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

describe("HubShell's search", () => {
  const everyKey = new Set(Object.keys(SETTINGS));
  const { index } = hubLayout({
    visible: everyKey,
    isAdmin: false,
    project: null,
    panes: [],
  });
  const rows = Object.fromEntries(
    Object.values(SETTINGS).map((definition) => [
      definition.key,
      {
        effective: definition.default,
        source: "default",
        writable: { user: true, instance: true },
        lockable: { user: false, instance: true },
        values: {},
      },
    ])
  );
  const sections = [
    {
      id: "personal" as const,
      label: "Personal",
      href: "/settings/personal",
      entries: [
        { id: "editor", label: "Editor", href: "/settings/personal/editor" },
      ],
      hasPanes: false,
    },
    {
      id: "devices" as const,
      label: "Devices",
      href: "/settings/devices",
      entries: [],
      hasPanes: true,
    },
  ];

  function renderHub(place: ComponentProps<typeof HubShell>["place"]) {
    return render(
      <SettingsProvider initial={effectiveSettings({}, "v1")}>
        <HubRowsProvider initial={rows} projectId={null} userId="u1">
          <HubShell sections={sections} place={place} index={index}>
            <div>Page content</div>
          </HubShell>
        </HubRowsProvider>
      </SettingsProvider>
    );
  }

  const statusText = () =>
    document.querySelector('p[role="status"]')?.textContent ?? "";

  it("filters settings and clears the query when clicking a search result link", async () => {
    renderHub({ section: "personal" });

    const box = screen.getByRole("searchbox", {
      name: "Search settings",
    }) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: "rhyme prefix" } });
    });

    expect(statusText()).toMatch(/settings? match(?:es)? “rhyme prefix”/);

    // The result group's section link navigates to the group and clears search.
    const resultRegion = screen.getByRole("region", {
      name: "Editor, Personal",
    });
    const resultLink = resultRegion.querySelector("a")!;
    await act(async () => {
      fireEvent.click(resultLink);
    });

    expect(box.value).toBe("");
    expect(statusText()).toBe("");
  });

  it("clears the query when clicking a sidebar nav link", async () => {
    renderHub({ section: "personal" });

    const box = screen.getByRole("searchbox", {
      name: "Search settings",
    }) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: "rhyme prefix" } });
    });
    expect(statusText()).toMatch(/settings? match(?:es)? “rhyme prefix”/);

    const nav = screen.getByRole("navigation", { name: "Settings" });
    const devicesLink = nav.querySelector('a[href="/settings/devices"]')!;
    await act(async () => {
      fireEvent.click(devicesLink);
    });

    expect(box.value).toBe("");
    expect(statusText()).toBe("");
  });

  it("clears the query when the active place changes", async () => {
    const { rerender } = renderHub({ section: "personal" });

    const box = screen.getByRole("searchbox", {
      name: "Search settings",
    }) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: "rhyme prefix" } });
    });
    expect(statusText()).toMatch(/settings? match(?:es)? “rhyme prefix”/);

    await act(async () => {
      rerender(
        <SettingsProvider initial={effectiveSettings({}, "v1")}>
          <HubRowsProvider initial={rows} projectId={null} userId="u1">
            <HubShell
              sections={sections}
              place={{ section: "devices" }}
              index={index}
            >
              <div>Page content</div>
            </HubShell>
          </HubRowsProvider>
        </SettingsProvider>
      );
    });

    expect(box.value).toBe("");
    expect(statusText()).toBe("");
  });
});
