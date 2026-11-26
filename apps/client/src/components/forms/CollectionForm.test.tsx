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

const createCollection = mock(async () => ({ id: 1, title: "Collection" }));
mock.module("@/actions/collections", () => ({ createCollection }));

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

const { CollectionForm } = await import("./CollectionForm");
const { SettingsProvider } = await import("@/lib/settings/provider");
const { effectiveSettings } = await import("@/lib/settings/effective");

afterEach(() => {
  cleanup();
  createCollection.mockClear();
  push.mockClear();
  toastSuccess.mockClear();
  toastError.mockClear();
});

async function renderCollectionForm() {
  await act(async () => {
    render(<CollectionForm projectId={1} statusesProm={Promise.resolve([])} />);
  });
}

const submit = () =>
  act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create collection" }));
  });

const shipped: Status = {
  id: 4,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  name: "Shipped",
  percentage: 100,
  description: null,
  // eslint-disable-next-line no-restricted-syntax -- a status's own colourHex, not a class name
  colourHex: "#336699",
  projectId: null,
};

async function renderWithDefault(statusId: number) {
  await act(async () => {
    render(
      <SettingsProvider
        initial={effectiveSettings(
          { "project-defaults.collectionStatusId": statusId },
          "v1"
        )}
      >
        <CollectionForm
          projectId={1}
          statusesProm={Promise.resolve([shipped])}
        />
      </SettingsProvider>
    );
  });
}

describe("CollectionForm", () => {
  it("starts a new collection with the default status", async () => {
    await renderWithDefault(4);

    expect(screen.queryByText("— none —")).toBeNull();
    expect(document.getElementById("statusId")?.textContent).toMatch(
      /shipped/i
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Up All Night" },
    });
    await submit();

    expect(createCollection).toHaveBeenCalledWith(
      expect.objectContaining({ statusId: 4 })
    );
  });

  it("leaves the status blank when the default one is gone from the project", async () => {
    await renderWithDefault(99);

    expect(screen.getByText("— none —")).toBeTruthy();
  });

  it("shows 'Must be a date (YYYY-MM-DD)' for an invalid release date", async () => {
    await renderCollectionForm();

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Up All Night" },
    });

    // A native `type="date"` input silently empties an invalid value rather
    // than holding it, so the invalid string is forced past that sanitizer
    // the way a real one never could be, to reach the kind's own `parse`.
    const releaseDate = screen.getByLabelText(
      "Release date"
    ) as HTMLInputElement;
    Object.defineProperty(releaseDate, "value", {
      writable: true,
      value: "banana",
    });
    fireEvent.change(releaseDate);
    await submit();

    expect(screen.getByText("Must be a date (YYYY-MM-DD)")).toBeTruthy();
    expect(createCollection).not.toHaveBeenCalled();
  });

  it("sends a filled custom field in the fields bag, and a link it cannot read nowhere", async () => {
    await act(async () => {
      render(
        <CollectionForm
          projectId={1}
          statusesProm={Promise.resolve([])}
          customFields={[
            customField(7, "Catalogue no.", "text", [], "collection"),
            customField(9, "Press kit", "url", [], "collection"),
          ]}
        />
      );
    });
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Night Drive EP" },
    });
    fireEvent.change(screen.getByLabelText("Catalogue no."), {
      target: { value: "ND-001" },
    });
    fireEvent.change(screen.getByLabelText("Press kit"), {
      target: { value: "press.example.com" },
    });
    await submit();
    expect(screen.getByText("Must be a full link (https://…)")).toBeTruthy();
    expect(createCollection).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Press kit"), {
      target: { value: "" },
    });
    await submit();
    expect(createCollection).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Night Drive EP",
        fields: { cf_7: "ND-001" },
      })
    );
  });
});
