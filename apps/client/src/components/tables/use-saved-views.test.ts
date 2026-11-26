import { beforeEach, describe, expect, it, mock } from "bun:test";
import { renderHook } from "@testing-library/react";
import type { SavedView } from "@workspace/api/api";
import type { DefaultSavedViewMap } from "@/lib/default-saved-view";

const createSavedView = mock();
const deleteSavedView = mock();
const updateSavedView = mock();
mock.module("@/entities/mutations", () => ({
  createSavedView,
  deleteSavedView,
  updateSavedView,
}));

const mutate = mock();
mock.module("@/hooks/use-mutate", () => ({ useMutate: mock(() => mutate) }));

const toastError = mock();
const toastSuccess = mock();
mock.module("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));

let defaultSavedViews: DefaultSavedViewMap = {};
const writeUserSettings = mock(async () => ({}));
mock.module("@/lib/settings/provider", () => ({
  useSetting: mock(() => defaultSavedViews),
  useUserSettingsWrite: mock(() => writeUserSettings),
}));

const { useSavedViews } = await import("./use-saved-views");

const VIEWS = [{ id: 1, name: "Mixing" }] as unknown as SavedView[];

function setup(views = VIEWS, me = "user-1") {
  return renderHook(() => useSavedViews(12, "track", views, me)).result;
}

beforeEach(() => {
  for (const fn of [
    createSavedView,
    deleteSavedView,
    updateSavedView,
    mutate,
    toastError,
    toastSuccess,
    writeUserSettings,
  ])
    fn.mockReset();
  createSavedView.mockReturnValue("create-mutation");
  deleteSavedView.mockReturnValue("delete-mutation");
  updateSavedView.mockReturnValue("update-mutation");
  writeUserSettings.mockResolvedValue({});
  defaultSavedViews = {};
});

describe("useSavedViews", () => {
  it("exposes the views it was given", () => {
    expect(setup().current.views).toBe(VIEWS);
  });

  it("keeps the config referentially stable across re-renders", () => {
    const { result, rerender } = renderHook(() =>
      useSavedViews(12, "track", VIEWS, "user-1")
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  describe("onSave", () => {
    it("runs the create mutation for the project, kind, name and query", async () => {
      mutate.mockResolvedValue({ id: 5 });
      await setup().current.onSave("Mixing", "sort=title");
      expect(createSavedView).toHaveBeenCalledWith(
        12,
        "track",
        "Mixing",
        "sort=title"
      );
      expect(mutate).toHaveBeenCalledWith("create-mutation");
    });

    it("resolves true with a success toast naming the view", async () => {
      mutate.mockResolvedValue({ id: 5 });
      expect(await setup().current.onSave("Mixing", "sort=title")).toBe(true);
      expect(toastSuccess).toHaveBeenCalledWith('Saved view "Mixing"');
      expect(toastError).not.toHaveBeenCalled();
    });

    it("resolves false with an error toast built from the result's error", async () => {
      mutate.mockResolvedValue({ error: "Name already taken" });
      expect(await setup().current.onSave("Mixing", "sort=title")).toBe(false);
      expect(toastError).toHaveBeenCalledWith(
        "Failed to save view: Name already taken"
      );
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  describe("onDelete", () => {
    it("runs the delete mutation for the project and view", async () => {
      mutate.mockResolvedValue({});
      await setup().current.onDelete(3);
      expect(deleteSavedView).toHaveBeenCalledWith(12, 3);
      expect(mutate).toHaveBeenCalledWith("delete-mutation");
    });

    it("resolves true without any toast", async () => {
      mutate.mockResolvedValue({});
      expect(await setup().current.onDelete(3)).toBe(true);
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    });

    it("resolves false with an error toast built from the result's error", async () => {
      mutate.mockResolvedValue({ error: "Not found" });
      expect(await setup().current.onDelete(3)).toBe(false);
      expect(toastError).toHaveBeenCalledWith(
        "Failed to delete view: Not found"
      );
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  it("passes the caller's id through as me", () => {
    expect(setup(VIEWS, "user-9").current.me).toBe("user-9");
  });

  describe("onShare", () => {
    it("runs the update mutation with the project, view and shared flag", async () => {
      mutate.mockResolvedValue({ id: 3 });
      await setup().current.onShare(3, true);
      expect(updateSavedView).toHaveBeenCalledWith(12, 3, { shared: true });
      expect(mutate).toHaveBeenCalledWith("update-mutation");
    });

    it("resolves true without any toast", async () => {
      mutate.mockResolvedValue({ id: 3 });
      expect(await setup().current.onShare(3, true)).toBe(true);
      expect(toastSuccess).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    });

    it("resolves false with an error toast built from the result's error", async () => {
      mutate.mockResolvedValue({ error: "Not the owner" });
      expect(await setup().current.onShare(3, true)).toBe(false);
      expect(toastError).toHaveBeenCalledWith(
        "Failed to update view: Not the owner"
      );
      expect(toastSuccess).not.toHaveBeenCalled();
    });
  });

  describe("defaultViewId", () => {
    it("is null when the project has no default for this kind", () => {
      defaultSavedViews = { "12": { collection: 1 } };
      expect(setup().current.defaultViewId).toBeNull();
    });

    it("reads this project and kind's entry", () => {
      defaultSavedViews = { "12": { track: 1 } };
      expect(setup(VIEWS).current.defaultViewId).toBe(1);
    });

    it("is null, and the stale entry is cleared, once the default view is gone", () => {
      defaultSavedViews = { "12": { track: 404 } };
      const { result } = renderHook(() =>
        useSavedViews(12, "track", VIEWS, "user-1")
      );

      expect(result.current.defaultViewId).toBeNull();
      expect(writeUserSettings).toHaveBeenCalledWith({
        "tables.defaultSavedView": {},
      });
    });

    it("keeps the default when the table holds no list of its own", () => {
      defaultSavedViews = { "12": { track: 1 } };
      const { result } = renderHook(() =>
        useSavedViews(12, "track", undefined, "user-1")
      );

      expect(result.current.views).toEqual([]);
      expect(result.current.defaultViewId).toBe(1);
      expect(writeUserSettings).not.toHaveBeenCalled();
    });
  });

  describe("onSetDefault", () => {
    it("writes this project and kind's entry into the existing map", async () => {
      defaultSavedViews = { "9": { track: 5 } };
      expect(await setup().current.onSetDefault(1)).toBe(true);
      expect(writeUserSettings).toHaveBeenCalledWith({
        "tables.defaultSavedView": { "9": { track: 5 }, "12": { track: 1 } },
      });
    });

    it("resolves false with an error toast on failure", async () => {
      writeUserSettings.mockRejectedValue(new Error("nope"));
      expect(await setup().current.onSetDefault(1)).toBe(false);
      expect(toastError).toHaveBeenCalledWith("Failed to set the default view");
    });
  });

  describe("onClearDefault", () => {
    it("removes this project and kind's entry, keeping the rest of the map", async () => {
      defaultSavedViews = { "9": { track: 5 }, "12": { track: 1 } };
      expect(await setup().current.onClearDefault(1)).toBe(true);
      expect(writeUserSettings).toHaveBeenCalledWith({
        "tables.defaultSavedView": { "9": { track: 5 } },
      });
    });

    it("resolves false with an error toast on failure", async () => {
      defaultSavedViews = { "12": { track: 1 } };
      writeUserSettings.mockRejectedValue(new Error("nope"));
      expect(await setup().current.onClearDefault(1)).toBe(false);
      expect(toastError).toHaveBeenCalledWith(
        "Failed to clear the default view"
      );
    });
  });
});
