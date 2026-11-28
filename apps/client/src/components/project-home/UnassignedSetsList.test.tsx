import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import * as clientApi from "@/lib/client-api";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { Session, TrackSummary } from "@workspace/api/api";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import type { ReactNode } from "react";
import type { UnassignedSetItem } from "./UnassignedSetsList";

const routerPush = mock();
const routerRefresh = mock();

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: routerPush,
    refresh: routerRefresh,
  }),
}));

mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({
    href,
    children,
    ...props
  }: React.ComponentProps<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const sessionPatchMock = mock(
  async (_api: unknown, _id: number, body: unknown) => ({
    id: _id,
    ...(body as object),
  })
);
const trackCreateMock = mock(
  async (_api: unknown, body: { title: string }) => ({
    id: 99,
    title: body.title,
  })
);
const trackRemoveMock = mock(async (...args: [unknown, number]) => {
  void args;
  return { ok: true };
});

mock.module("@/entities/api", () => ({
  ENTITY_API: {
    session: {
      patch: sessionPatchMock,
    },
    track: {
      create: trackCreateMock,
      remove: trackRemoveMock,
    },
  },
}));

const toastSuccessCalls: {
  message: string;
  options?: {
    action?: { label: string; onClick: () => void };
    cancel?: { label: string; onClick: () => void };
  };
}[] = [];
const toastErrorMock = mock();
const toastSuccessMock = mock(
  (
    message: string,
    options?: {
      action?: { label: string; onClick: () => void };
      cancel?: { label: string; onClick: () => void };
    }
  ) => {
    toastSuccessCalls.push({ message, options });
  }
);

mock.module("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    dismiss: mock(),
  },
}));

const TRACKS: TrackSummary[] = [
  {
    id: 1,
    title: "Want You Gone",
    artists: ["Alex"],
  } as unknown as TrackSummary,
  { id: 2, title: "Midnight Drive", artists: [] } as unknown as TrackSummary,
];

let trackSessionsById: Record<number, Session[]> = {
  1: [],
  2: [{ id: 500, main: true } as unknown as Session],
};

const getTrackSummariesMock = mock(async () => TRACKS);
const getTrackSessionsMock = mock(
  async (trackId: number) => trackSessionsById[trackId] ?? []
);

mock.module("@/lib/client-api", () => ({
  ...clientApi,
  clientGetTrackSummaries: getTrackSummariesMock,
  clientGetTrackSessions: getTrackSessionsMock,
}));

const { UnassignedSetsList } = await import("./UnassignedSetsList");

const ITEM: UnassignedSetItem = {
  id: 50,
  name: "want_you_gone_v3.als",
  daw: "ableton",
  dawName: "Ableton Live",
  saveCount: 4,
  lastSaveAt: "2026-09-14T10:00:00.000Z",
  localFileUpdatedAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
  rootNote: "C#",
  scale: "Minor",
  tempo: "128",
} as unknown as UnassignedSetItem;

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <PoliciesProvider policies={DEFAULT_POLICIES}>
      <TooltipProvider>{children}</TooltipProvider>
    </PoliciesProvider>
  );
}

afterEach(() => {
  cleanup();
  toastSuccessCalls.length = 0;
  trackSessionsById = {
    1: [],
    2: [{ id: 500, main: true } as unknown as Session],
  };
  sessionPatchMock.mockClear();
  trackCreateMock.mockClear();
  trackRemoveMock.mockClear();
  getTrackSummariesMock.mockClear();
  getTrackSessionsMock.mockClear();
  toastSuccessMock.mockClear();
  toastErrorMock.mockClear();
  routerPush.mockClear();
  routerRefresh.mockClear();
});

describe("UnassignedSetsList", () => {
  it("hoists fuzzy Suggested match, auto-sets main: true when target track has none, and reverts on Undo", async () => {
    render(<UnassignedSetsList projectId={5} sessions={[ITEM]} total={1} />, {
      wrapper: Wrapper,
    });

    fireEvent.click(screen.getByRole("button", { name: "Link to track" }));

    await waitFor(() => {
      expect(screen.getByText(/Suggested match/)).toBeTruthy();
    });

    const items = screen.getAllByRole("option");
    expect(items[0]!.textContent).toContain("Want You Gone");

    await act(async () => {
      fireEvent.click(items[0]!);
    });

    await waitFor(() => {
      expect(sessionPatchMock).toHaveBeenCalledTimes(1);
    });
    expect(getTrackSessionsMock).toHaveBeenCalledWith(1);
    expect(sessionPatchMock.mock.calls[0]![1]).toBe(50);
    expect(sessionPatchMock.mock.calls[0]![2]).toEqual({
      trackId: 1,
      main: true,
    });
    expect(screen.queryByText("want_you_gone_v3.als")).toBeNull();

    // Trigger Undo from the toast action.
    const toastCall = toastSuccessCalls.at(-1)!;
    expect(toastCall.message).toContain("Want You Gone");
    await act(async () => {
      toastCall.options!.action!.onClick();
    });

    await waitFor(() => {
      expect(sessionPatchMock).toHaveBeenCalledTimes(2);
    });
    expect(sessionPatchMock.mock.calls[1]![2]).toEqual({
      trackId: null,
      main: false,
    });
    expect(screen.getByText("want_you_gone_v3.als")).toBeTruthy();
  });

  it("sends main: false when target track already has a main session and preserves it on Undo", async () => {
    render(<UnassignedSetsList projectId={5} sessions={[ITEM]} total={1} />, {
      wrapper: Wrapper,
    });

    fireEvent.click(screen.getByRole("button", { name: "Link to track" }));

    await waitFor(() => {
      expect(screen.getByText("Midnight Drive")).toBeTruthy();
    });

    const items = screen.getAllByRole("option");
    const midnightOption = items.find((el) =>
      el.textContent?.includes("Midnight Drive")
    )!;

    await act(async () => {
      fireEvent.click(midnightOption);
    });

    await waitFor(() => {
      expect(sessionPatchMock).toHaveBeenCalledTimes(1);
    });
    expect(getTrackSessionsMock).toHaveBeenCalledWith(2);
    expect(sessionPatchMock.mock.calls[0]![2]).toEqual({
      trackId: 2,
      main: false,
    });

    const toastCall = toastSuccessCalls.at(-1)!;
    await act(async () => {
      toastCall.options!.action!.onClick();
    });

    await waitFor(() => {
      expect(sessionPatchMock).toHaveBeenCalledTimes(2);
    });
    expect(sessionPatchMock.mock.calls[1]![2]).toEqual({ trackId: null });
  });

  it("creates a track without dead bpm/key fields, promotes session to main, and reverts on Undo", async () => {
    render(<UnassignedSetsList projectId={5} sessions={[ITEM]} total={1} />, {
      wrapper: Wrapper,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New track" }));
    });

    await waitFor(() => {
      expect(trackCreateMock).toHaveBeenCalledTimes(1);
    });
    const createBody = trackCreateMock.mock.calls[0]![1] as Record<
      string,
      unknown
    >;
    expect(createBody).toEqual({
      projectId: 5,
      title: "want you gone",
    });
    expect("bpm" in createBody).toBe(false);
    expect("key" in createBody).toBe(false);

    expect(sessionPatchMock).toHaveBeenCalledTimes(1);
    expect(sessionPatchMock.mock.calls[0]![2]).toEqual({
      trackId: 99,
      main: true,
    });
    expect(screen.queryByText("want_you_gone_v3.als")).toBeNull();

    const toastCall = toastSuccessCalls.at(-1)!;
    expect(toastCall.message).toContain("want you gone");
    await act(async () => {
      toastCall.options!.cancel!.onClick();
    });

    await waitFor(() => {
      expect(trackRemoveMock).toHaveBeenCalledTimes(1);
    });
    expect(sessionPatchMock.mock.calls[1]![2]).toEqual({
      trackId: null,
      main: false,
    });
    expect(trackRemoveMock.mock.calls[0]![1]).toBe(99);
    expect(screen.getByText("want_you_gone_v3.als")).toBeTruthy();
  });

  it("ignores a set via inboxDismissedAt and restores it on Undo", async () => {
    render(<UnassignedSetsList projectId={5} sessions={[ITEM]} total={1} />, {
      wrapper: Wrapper,
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Ignore want_you_gone_v3.als" })
      );
    });

    await waitFor(() => {
      expect(sessionPatchMock).toHaveBeenCalledTimes(1);
    });
    const patchBody = sessionPatchMock.mock.calls[0]![2] as {
      inboxDismissedAt: string;
    };
    expect(typeof patchBody.inboxDismissedAt).toBe("string");
    expect(Number.isNaN(Date.parse(patchBody.inboxDismissedAt))).toBe(false);
    expect(screen.queryByText("want_you_gone_v3.als")).toBeNull();

    const toastCall = toastSuccessCalls.at(-1)!;
    await act(async () => {
      toastCall.options!.action!.onClick();
    });

    await waitFor(() => {
      expect(sessionPatchMock).toHaveBeenCalledTimes(2);
    });
    expect(sessionPatchMock.mock.calls[1]![2]).toEqual({
      inboxDismissedAt: null,
    });
    expect(screen.getByText("want_you_gone_v3.als")).toBeTruthy();
  });
});
