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
    patchField.mockReset();
    toastError.mockReset();
  });

  it("patches statusId on the kind's own route", async () => {
    patchField.mockResolvedValue({ id: 7, statusId: 1 });
    renderDropdown();

    await openMenu();
    const item = await screen.findByRole("menuitem", { name: /mixing/i });
    fireEvent.click(item);

    await waitFor(() =>
      expect(patchField).toHaveBeenCalledWith("track", 7, "statusId", 1)
    );
  });

  it("words the failure with the kind's noun", async () => {
    patchField.mockResolvedValue({ error: "a status from another project" });
    renderDropdown({ targetKind: "collection" });

    await openMenu();
    const item = await screen.findByRole("menuitem", { name: /mixing/i });
    fireEvent.click(item);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Failed to update collection status."
      )
    );
  });
});
