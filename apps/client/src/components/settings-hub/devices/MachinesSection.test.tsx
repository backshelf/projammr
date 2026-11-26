import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock,
} from "bun:test";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import { advanceTimersByTimeAsync } from "@workspace/test/timers";
import type { Machine, MachineList } from "@workspace/api/api";
import type { ComponentProps } from "react";

type Result = { data?: unknown; error?: unknown; response: Response };
type Call = (path: string, init?: unknown) => Promise<Result>;
const GET = mock<Call>();
const DELETE = mock<Call>();
mock.module("@/lib/browser-api", () => ({
  browserApi: { GET, DELETE },
}));

const routerRefresh = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

const toastSuccess = mock();
const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// The real link prefetches on a timer, outside any `act`.
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

const { DESKTOP_APP_DOWNLOAD_URL } = await import("@workspace/ui/lib/site");
const { MachinesSection } = await import("./MachinesSection");
const { MACHINE_POLL_MS } = await import("./machine-poll");

const STUDIO = "machine-0001-abcdef";
const LAPTOP = "machine-0002-abcdef";

const secondsAgo = (seconds: number) =>
  new Date(Date.now() - seconds * 1000).toISOString();

const machine = (over: Partial<Machine> = {}): Machine => ({
  id: STUDIO,
  name: "Studio Mac",
  platform: "macOS",
  appVersion: "0.10.0",
  lastSeenAt: secondsAgo(20),
  online: true,
  openSessionId: null,
  repoIds: [],
  openSession: null,
  pushedRepos: [],
  neverHere: [],
  ...over,
});

const list = (
  machines: Machine[],
  notABounce: MachineList["notABounce"] = []
): MachineList => ({ machines, notABounce });

const ok = (data: unknown, status = 200): Result => ({
  data,
  response: new Response(null, { status }),
});
const done = (): Result => ({ response: new Response(null, { status: 204 }) });

/** What the machines read answers; a test sets it to what the server would say next. */
let served: MachineList = list([]);
const machineReads = () =>
  GET.mock.calls.filter(([path]) => path === "/api/machines").length;

function mount(
  initial: MachineList | null,
  confirmDeletes: Partial<typeof DEFAULT_POLICIES.feedback.confirmDeletes> = {}
) {
  return render(
    <PoliciesProvider
      policies={{
        ...DEFAULT_POLICIES,
        feedback: {
          ...DEFAULT_POLICIES.feedback,
          confirmDeletes: {
            ...DEFAULT_POLICIES.feedback.confirmDeletes,
            ...confirmDeletes,
          },
        },
      }}
    >
      <MachinesSection initial={initial} />
    </PoliciesProvider>
  );
}

const settle = (ms = 0) =>
  act(async () => {
    await advanceTimersByTimeAsync(ms);
  });

const row = (name: string) =>
  screen.getByRole("listitem", { name }) as HTMLElement;

beforeEach(() => {
  jest.useFakeTimers();
  served = list([]);
  for (const request of [GET, DELETE]) request.mockReset();
  GET.mockImplementation(async () => ok(served));
  toastSuccess.mockReset();
  toastError.mockReset();
  routerRefresh.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("MachinesSection with no machine", () => {
  it("says none is registered and links to the dit page", () => {
    mount(list([]));

    expect(screen.getByText("No machines yet.")).toBeTruthy();
    expect(
      screen.getByText("Install dit on the Mac you make music on.")
    ).toBeTruthy();
    const link = screen.getByRole("link", { name: /Download dit for Mac/ });
    expect(link.getAttribute("href")).toBe(DESKTOP_APP_DOWNLOAD_URL);
    expect(link.getAttribute("href")).not.toContain(".example");
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("says the list could not be read, then shows it once a read answers", async () => {
    served = list([machine()]);
    mount(null);
    expect(screen.getByText(/Couldn.t read your machines/)).toBeTruthy();

    await settle(MACHINE_POLL_MS);

    expect(row("Studio Mac")).toBeTruthy();
    expect(screen.queryByText(/Couldn.t read your machines/)).toBeNull();
  });
});

describe("MachinesSection's rows", () => {
  it("shows each machine's platform, version and state in words", () => {
    mount(
      list([
        machine(),
        machine({
          id: LAPTOP,
          name: "Laptop",
          online: false,
          lastSeenAt: secondsAgo(3 * 3600),
        }),
      ])
    );

    const studio = row("Studio Mac");
    expect(within(studio).getByText("macOS")).toBeTruthy();
    expect(within(studio).getByText("dit 0.10.0")).toBeTruthy();
    expect(within(studio).getByText("online")).toBeTruthy();
    const laptop = row("Laptop");
    expect(within(laptop).getByText("Last seen 3 hours ago")).toBeTruthy();
    expect(within(laptop).queryByText("online")).toBeNull();
  });

  it("gives each row the anchor its #machine-<id> link names", () => {
    mount(list([machine(), machine({ id: LAPTOP, name: "Laptop" })]));

    expect(row("Studio Mac").id).toBe(`machine-${STUDIO}`);
    expect(row("Laptop").id).toBe(`machine-${LAPTOP}`);
    // Focusable by the script that lands on it, but not a tab stop of its own.
    expect(row("Studio Mac").getAttribute("tabindex")).toBe("-1");
  });

  it("names the set open on the machine", () => {
    mount(
      list([
        machine({ openSession: { id: 9, name: "science123" } }),
        machine({ id: LAPTOP, name: "Laptop" }),
      ])
    );

    expect(
      within(row("Studio Mac")).getByText("Open: science123")
    ).toBeTruthy();
    expect(within(row("Laptop")).queryByText(/^Open:/)).toBeNull();
  });

  it("links the repos a machine has pushed to their pages", () => {
    mount(
      list([
        machine({
          pushedRepos: [
            { id: 7, name: "Night Drive", projectId: 3 },
            { id: 8, name: "Demos", projectId: 4 },
          ],
        }),
        machine({ id: LAPTOP, name: "Laptop" }),
      ])
    );

    const studio = row("Studio Mac");
    expect(
      within(studio)
        .getByRole("link", { name: "Night Drive" })
        .getAttribute("href")
    ).toBe("/project/3/repo/7");
    expect(
      within(studio).getByRole("link", { name: "Demos" }).getAttribute("href")
    ).toBe("/project/4/repo/8");
    expect(within(studio).getByRole("list", { name: "Pushed" })).toBeTruthy();
    expect(within(row("Laptop")).queryByText("Pushed")).toBeNull();
  });

  it("lists a machine's Never here folders under it, and no other machine's", () => {
    mount(
      list([
        machine({ neverHere: [{ id: 21, folder: "/Users/s/Bounces" }] }),
        machine({ id: LAPTOP, name: "Laptop" }),
      ])
    );

    const folders = within(row("Studio Mac")).getByRole("list", {
      name: "Never here",
    });
    expect(within(folders).getByText("/Users/s/Bounces")).toBeTruthy();
    expect(within(row("Laptop")).queryByText("Never here")).toBeNull();
  });
});

describe("MachinesSection's Not a bounce files", () => {
  const files = [
    {
      id: 31,
      fingerprint: "dit:100:abc",
      fileName: "Night v3.wav",
      createdAt: secondsAgo(60),
    },
    {
      id: 32,
      fingerprint: "dit:200:def",
      fileName: null,
      createdAt: secondsAgo(60),
    },
  ];

  it("lists them once, above the machines, a file the app cannot name by its fingerprint", () => {
    mount(list([machine(), machine({ id: LAPTOP, name: "Laptop" })], files));

    const bounces = screen.getByRole("list", { name: "Not a bounce" });
    expect(screen.getAllByRole("list", { name: "Not a bounce" })).toHaveLength(
      1
    );
    expect(within(bounces).getByText("Night v3.wav")).toBeTruthy();
    expect(within(bounces).getByText("dit:200:def")).toBeTruthy();
    // Above the machine rows in the page.
    expect(
      bounces.compareDocumentPosition(row("Studio Mac")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("leaves the list out when there are none", () => {
    mount(list([machine()]));

    expect(screen.queryByText("Not a bounce")).toBeNull();
  });

  it("takes a file back by its own named button", async () => {
    mount(list([machine()], files));
    DELETE.mockResolvedValue(done());
    served = list([machine()], [files[1]!]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Night v3.wav from Not a bounce",
      })
    );
    await settle();

    expect(DELETE.mock.calls[0]).toEqual([
      "/api/machines/rejections/{id}",
      { params: { path: { id: "31" } } },
    ]);
    expect(machineReads()).toBe(1);
    expect(screen.queryByText("Night v3.wav")).toBeNull();
    expect(screen.getByText("dit:200:def")).toBeTruthy();
  });

  it("takes a Never here folder back by its own named button", async () => {
    mount(
      list([machine({ neverHere: [{ id: 21, folder: "/Users/s/Bounces" }] })])
    );
    DELETE.mockResolvedValue(done());
    served = list([machine()]);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove /Users/s/Bounces from Never here",
      })
    );
    await settle();

    expect(DELETE.mock.calls[0]).toEqual([
      "/api/machines/rejections/{id}",
      { params: { path: { id: "21" } } },
    ]);
    expect(screen.queryByText("/Users/s/Bounces")).toBeNull();
  });

  it("says why when a file cannot be taken back, and keeps it listed", async () => {
    mount(list([machine()], files));
    DELETE.mockResolvedValue({
      error: { error: "Not found" },
      response: new Response(null, { status: 404 }),
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Remove Night v3.wav from Not a bounce",
      })
    );
    await settle();

    expect(toastError).toHaveBeenCalled();
    expect(screen.getByText("Night v3.wav")).toBeTruthy();
  });
});

describe("Removing a machine", () => {
  it("asks first, then removes it and reads the list again", async () => {
    mount(list([machine(), machine({ id: LAPTOP, name: "Laptop" })]));
    DELETE.mockResolvedValue(done());
    served = list([machine({ id: LAPTOP, name: "Laptop" })]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Studio Mac" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Remove Studio Mac?")).toBeTruthy();
    expect(
      within(dialog).getByText(
        "It's signed out of dit; its saves and commits stay."
      )
    ).toBeTruthy();
    expect(DELETE).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
    await settle();

    expect(DELETE.mock.calls[0]).toEqual([
      "/api/machines/{id}",
      { params: { path: { id: STUDIO } } },
    ]);
    expect(toastSuccess).toHaveBeenCalledWith("Studio Mac removed", undefined);
    expect(machineReads()).toBe(1);
    expect(screen.queryByRole("listitem", { name: "Studio Mac" })).toBeNull();
    expect(row("Laptop")).toBeTruthy();
  });

  it("removes at once when the viewer asked not to be asked", async () => {
    mount(list([machine()]), { machine: false });
    DELETE.mockResolvedValue(done());
    served = list([]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Studio Mac" }));
    await settle();

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(DELETE).toHaveBeenCalledTimes(1);
    expect(screen.getByText("No machines yet.")).toBeTruthy();
  });

  it("keeps the machine and says why when the hub refuses", async () => {
    mount(list([machine()]));
    DELETE.mockResolvedValue({
      error: { error: "Not yours" },
      response: new Response(null, { status: 403 }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove Studio Mac" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Remove",
      })
    );
    await settle();

    expect(toastError).toHaveBeenCalled();
    expect(machineReads()).toBe(0);
    expect(row("Studio Mac")).toBeTruthy();
  });

  it("leaves a machine another tab removed off the list at the next poll", async () => {
    mount(list([machine(), machine({ id: LAPTOP, name: "Laptop" })]));
    served = list([machine()]);

    await settle(MACHINE_POLL_MS);

    expect(screen.queryByRole("listitem", { name: "Laptop" })).toBeNull();
    expect(row("Studio Mac")).toBeTruthy();
  });
});
