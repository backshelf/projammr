import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

let currentSearch = "";
const routerReplace = mock();

mock.module("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplace }),
  usePathname: () => "/project/5/track/10",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const { useParamWriter } = await import("./use-param-writer");

afterEach(() => {
  currentSearch = "";
  routerReplace.mockClear();
});

describe("useParamWriter", () => {
  it("navigates via router.replace by default", () => {
    currentSearch = "studio=overview&keep=1";
    const replaceStateSpy = spyOn(window.history, "replaceState");
    try {
      const { result } = renderHook(() => useParamWriter());
      act(() => {
        result.current.write({ studio: "history", keep: null });
      });

      expect(routerReplace).toHaveBeenCalledWith(
        "/project/5/track/10?studio=history",
        { scroll: false }
      );
      expect(replaceStateSpy).not.toHaveBeenCalled();
    } finally {
      replaceStateSpy.mockRestore();
    }
  });

  it("updates URL via window.history.replaceState without router.replace when shallow", () => {
    currentSearch = "studio=overview&session=812";
    const replaceStateSpy = spyOn(window.history, "replaceState");
    try {
      const { result } = renderHook(() => useParamWriter({ shallow: true }));
      act(() => {
        result.current.write({ studio: "gear", from: null });
      });

      expect(replaceStateSpy).toHaveBeenCalledWith(
        null,
        "",
        "/project/5/track/10?studio=gear&session=812"
      );
      expect(routerReplace).not.toHaveBeenCalled();
    } finally {
      replaceStateSpy.mockRestore();
    }
  });

  it("drops the query string when all parameters are cleared", () => {
    currentSearch = "studio=overview";
    const replaceStateSpy = spyOn(window.history, "replaceState");
    try {
      const { result } = renderHook(() => useParamWriter({ shallow: true }));
      act(() => {
        result.current.write({ studio: null });
      });

      expect(replaceStateSpy).toHaveBeenCalledWith(
        null,
        "",
        "/project/5/track/10"
      );
    } finally {
      replaceStateSpy.mockRestore();
    }
  });
});
