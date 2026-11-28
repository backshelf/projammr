import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import type { ComponentProps } from "react";
import type { StatusDisplayType } from "@/components/status/StatusDisplay";

const patchField = mock();
mock.module("@/actions/patch-field", () => ({ patchField }));

const toastError = mock();
mock.module("sonner", () => ({ toast: { error: toastError } }));

// `StatusDropdown` calls neither of these, but the module graph a dropdown
// menu pulls in (navigation-aware siblings, `AppLink`) can still reach
// `next/navigation`, so it is stubbed the way the rest of the client suites
// stub it.
mock.module("next/navigation", () => ({
  useRouter: mock(() => ({ refresh: mock() })),
  usePathname: mock(),
}));

const { ProjectProvider } = await import("@/hooks/use-project-role");
const { StatusDropdown } = await import("./StatusDropdown");

afterEach(cleanup);

const mixing = (
  overrides: Partial<StatusDisplayType> = {}
): StatusDisplayType => ({
  id: 1,
  name: "Mixing",
  // eslint-disable-next-line no-restricted-syntax -- a status's own colourHex, not a class name
  colourHex: "#336699",
  percentage: 40,
  ...overrides,
});

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

const originalWidth = window.innerWidth;
afterEach(() => {
  setViewportWidth(originalWidth);
});

function renderDropdown(
  props: Partial<ComponentProps<typeof StatusDropdown>> = {}
) {
  return render(
    <StatusDropdown
      statuses={Promise.resolve([mixing()])}
      targetId={7}
      targetKind="track"
      {...props}
    >
      Set status
    </StatusDropdown>,
    { wrapper: MotionProvider }
  );
}

/** Opens the menu and lets the suspended status list resolve before returning. */
async function openMenu() {
  await act(async () => {
    fireEvent.click(screen.getByText("Set status"));
  });
}

describe("StatusDropdown", () => {
  beforeEach(() => {
    setViewportWidth(1024);
    patchField.mockReset();
    toastError.mockReset();
  });

  it("patches statusId on the kind's own route", async () => {
    patchField.mockResolvedValue({ id: 7, statusId: 1 });
    renderDropdown();

    await openMenu();
    const item = await screen.findByRole("option", { name: /mixing/i });
    fireEvent.click(item);

    await waitFor(() =>
      expect(patchField).toHaveBeenCalledWith("track", 7, "statusId", 1)
    );
  });

  it("words the failure with the kind's noun", async () => {
    patchField.mockResolvedValue({ error: "a status from another project" });
    renderDropdown({ targetKind: "collection" });

    await openMenu();
    const item = await screen.findByRole("option", { name: /mixing/i });
    fireEvent.click(item);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to update collection status."
      )
    );
  });

  it("shows status descriptions inline in the mobile sheet", async () => {
    setViewportWidth(390);
    renderDropdown({
      statuses: Promise.resolve([
        mixing({ description: "Balancing levels and panning" }),
      ]),
    });

    await openMenu();
    expect(
      document.querySelector('[data-slot="responsive-picker-sheet"]')
    ).not.toBeNull();
    expect(
      await screen.findByText("Balancing levels and panning")
    ).toBeTruthy();
  });

  it("renders the status read-only without a menu trigger for viewers", () => {
    render(
      <ProjectProvider project={{ id: 1, name: "P", role: "viewer" }}>
        <StatusDropdown
          statuses={Promise.resolve([mixing()])}
          targetId={7}
          targetKind="track"
          current={mixing()}
        />
      </ProjectProvider>,
      { wrapper: MotionProvider }
    );

    expect(screen.getByText(/mixing/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
