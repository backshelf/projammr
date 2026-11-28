import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import { customField } from "@/fields/custom-field-fixture";
import type { Status } from "@workspace/api/api";

const createTrack = mock(async () => ({ id: 1, title: "Track" }));
mock.module("@/actions/tracks", () => ({ createTrack }));

const push = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const toastSuccess = mock();
const toastError = mock();
mock.module("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// The block editor only mounts once hydrated; keeping it unhydrated in tests
// avoids pulling BlockNote's browser-only editor into happy-dom.
mock.module("@workspace/ui/hooks/use-hydrated", () => ({
  useHydrated: () => false,
}));

const { TrackForm } = await import("./TrackForm");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");

afterEach(() => {
  cleanup();
  createTrack.mockClear();
  push.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

async function renderTrackForm(statuses: Status[] = []) {
  await act(async () => {
    render(
      <TrackForm projectId={1} statusesProm={Promise.resolve(statuses)} />
    );
  });
}

const mixing: Status = {
  id: 7,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  name: "Mixing",
  percentage: 40,
  description: null,
  // eslint-disable-next-line no-restricted-syntax -- a status's own colourHex, not a class name
  colourHex: "#336699",
  projectId: null,
};

const submit = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create track" }));
  });

async function pickStatus(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByText("— none —"));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("option", { name }));
  });
}

describe("TrackForm", () => {
  it("submits a blank artists field as []", async () => {
    await renderTrackForm([mixing]);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "You Don't Know You're Beautiful" },
    });
    await pickStatus(/Mixing/);
    await submit();

    expect(createTrack).toHaveBeenCalledWith(
      expect.objectContaining({ artists: [] })
    );
  });

  it("refuses to submit without a status", async () => {
    await renderTrackForm([mixing]);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "You Don't Know You're Beautiful" },
    });
    await submit();

    expect(screen.getByText("Required")).toBeTruthy();
    expect(createTrack).not.toHaveBeenCalled();
  });

  it("shows 'Must be a number' for a non-numeric track position", async () => {
    await renderTrackForm();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "You Don't Know You're Beautiful" },
    });
    fireEvent.change(screen.getByLabelText("Track position"), {
      target: { value: "abc" },
    });
    await submit();

    expect(screen.getByText("Must be a number")).toBeTruthy();
    expect(createTrack).not.toHaveBeenCalled();
  });

  describe("with the project's defaults", () => {
    async function renderWithDefaults(
      values: Record<string, unknown>,
      statuses: Status[] = [mixing]
    ) {
      await act(async () => {
        render(
          <SettingsProvider initial={effectiveSettings(values, "v1")}>
            <TrackForm projectId={1} statusesProm={Promise.resolve(statuses)} />
          </SettingsProvider>
        );
      });
    }

    it("starts a new track with the default status, artists and explicit", async () => {
      await renderWithDefaults({
        "project-defaults.trackStatusId": 7,
        "project-defaults.artists": ["Ana", "Bo"],
        "project-defaults.explicit": true,
      });

      expect(screen.queryByText("— none —")).toBeNull();
      expect(document.getElementById("statusId")?.textContent).toMatch(
        /mixing/i
      );
      expect((screen.getByLabelText("Artists") as HTMLInputElement).value).toBe(
        "Ana, Bo"
      );
      expect(
        (screen.getByRole("checkbox", { name: "Explicit" }) as HTMLInputElement)
          .checked
      ).toBe(true);

      fireEvent.change(screen.getByLabelText("Title"), {
        target: { value: "Neon Rain" },
      });
      await submit();

      expect(createTrack).toHaveBeenCalledWith(
        expect.objectContaining({
          artists: ["Ana", "Bo"],
          statusId: 7,
          explicit: true,
        })
      );
    });

    it("leaves the status blank when the default one is gone from the project", async () => {
      await renderWithDefaults({ "project-defaults.trackStatusId": 99 });

      expect(screen.getByText("— none —")).toBeTruthy();
    });
  });

  describe("with the project's custom fields", () => {
    const fields = [
      customField(2, "Energy", "number"),
      customField(6, "Notes on mix", "text"),
    ];

    async function renderWithFields() {
      await act(async () => {
        render(
          <TrackForm
            projectId={1}
            statusesProm={Promise.resolve([mixing])}
            customFields={fields}
          />
        );
      });
      fireEvent.change(screen.getByLabelText("Title"), {
        target: { value: "Neon Rain" },
      });
      await pickStatus(/Mixing/);
    }

    it("offers a row per field, each optional", async () => {
      await renderWithFields();
      await submit();

      expect(screen.getByLabelText("Energy")).toBeTruthy();
      expect(screen.getByLabelText("Notes on mix")).toBeTruthy();
      const body = (createTrack.mock.calls[0] as unknown[])[0] as Record<
        string,
        unknown
      >;
      expect(body.fields).toBeUndefined();
      expect(body.cf_2).toBeUndefined();
    });

    it("sends the fields it filled in the fields bag, typed", async () => {
      await renderWithFields();
      fireEvent.change(screen.getByLabelText("Energy"), {
        target: { value: "7" },
      });
      await submit();

      expect(createTrack).toHaveBeenCalledWith(
        expect.objectContaining({ fields: { cf_2: 7 } })
      );
    });

    it("refuses a value the field's kind does not read", async () => {
      await renderWithFields();
      fireEvent.change(screen.getByLabelText("Energy"), {
        target: { value: "loud" },
      });
      await submit();

      expect(screen.getByText("Must be a number")).toBeTruthy();
      expect(createTrack).not.toHaveBeenCalled();
    });
  });

  it("submits the status id a real pick resolves to", async () => {
    await renderTrackForm([mixing]);

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "You Don't Know You're Beautiful" },
    });
    await pickStatus(/Mixing/);
    await submit();

    expect(createTrack).toHaveBeenCalledWith(
      expect.objectContaining({ statusId: 7 })
    );
  });

  it("folds distribution fields behind a mobile disclosure toggle", async () => {
    await renderTrackForm([mixing]);

    const toggle = screen.getByRole("button", {
      name: "Distribution & details",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.className).toContain("md:hidden");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });
});
