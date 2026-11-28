import type { Status } from "@workspace/api/api";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: mock(() => {}),
    replace: mock(() => {}),
    refresh: mock(() => {}),
  }),
  usePathname: () => "/project/1/track/all",
  useParams: () => ({ projectId: "1", route: ["track", "all"] }),
  useSearchParams: () => new URLSearchParams("view=board"),
}));

const { BoardView } = await import("./BoardView");

afterEach(cleanup);

type Row = { id: number; title: string; status?: Status | null };

const STATUSES: Status[] = [
  {
    id: 1,
    projectId: 1,
    name: "Idea",
    percentage: 10,
    description: null,
    colourHex: "var(--ink-soft)",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: 2,
    projectId: 1,
    name: "Mixing",
    percentage: 60,
    description: null,
    colourHex: "var(--ink-soft)",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

describe("BoardView", () => {
  it("loads a No status column (status=0), provides mobile column tabs, and moves cards via action menu", async () => {
    const fetchColumn = mock(async (statusId: number) => {
      if (statusId === 0) {
        return { rows: [{ id: 10, title: "Unset Track" }], rowCount: 1 };
      }
      if (statusId === 1) {
        return { rows: [{ id: 20, title: "Idea Track" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const onMoveCard = mock(async () => true);

    render(
      <MotionProvider>
        <BoardView<Row>
          statuses={STATUSES}
          fetchColumn={fetchColumn}
          toCard={(row) => ({ id: row.id, title: row.title })}
          toPeekRow={(row) => ({ id: row.id, title: row.title })}
          href={(row) => `/project/1/track/${row.id}`}
          onMoveCard={onMoveCard}
          entityLabel="track"
        />
      </MotionProvider>
    );

    await screen.findByText("Unset Track");

    expect(fetchColumn).toHaveBeenCalledWith(0, 1);
    expect(screen.getByRole("tab", { name: /no status/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /idea/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /mixing/i })).toBeTruthy();

    // Mobile defaults to the first real status tab rather than empty "No status"
    expect(
      screen.getByRole("tab", { name: /idea/i }).getAttribute("aria-selected")
    ).toBe("true");
    expect(
      screen
        .getByRole("tab", { name: /no status/i })
        .getAttribute("aria-selected")
    ).toBe("false");

    // Empty "No status" column uses clean phrasing ("No items without a status")
    expect(screen.getByText("No mixing items")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /mixing/i }));
    expect(
      screen.getByRole("tab", { name: /mixing/i }).getAttribute("aria-selected")
    ).toBe("true");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Actions for Unset Track" })
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /mixing/i }));
    });

    expect(onMoveCard).toHaveBeenCalledWith(10, 2);
  });

  it("renders 'No items without a status' when the No status column is empty", async () => {
    const fetchColumn = mock(async (statusId: number) => {
      if (statusId === 1) {
        return { rows: [{ id: 20, title: "Idea Track" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    render(
      <MotionProvider>
        <BoardView<Row>
          statuses={STATUSES}
          fetchColumn={fetchColumn}
          toCard={(row) => ({ id: row.id, title: row.title })}
          toPeekRow={(row) => ({ id: row.id, title: row.title })}
          href={(row) => `/project/1/track/${row.id}`}
          onMoveCard={async () => true}
          entityLabel="track"
        />
      </MotionProvider>
    );

    await screen.findByText("Idea Track");
    expect(screen.getByText("No items without a status")).toBeTruthy();
  });

  it("updates row.status in PeekPanel after moving a card and reverts on failure", async () => {
    let shouldSucceed = true;
    const fetchColumn = mock(async (statusId: number) => {
      if (statusId === 1) {
        return {
          rows: [{ id: 20, title: "Idea Track", status: STATUSES[0]! }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const onMoveCard = mock(async () => shouldSucceed);

    render(
      <MotionProvider>
        <BoardView<Row>
          statuses={STATUSES}
          fetchColumn={fetchColumn}
          toCard={(row) => ({ id: row.id, title: row.title })}
          toPeekRow={(row) => ({
            id: row.id,
            title: row.title,
            status: row.status ?? null,
          })}
          href={(row) => `/project/1/track/${row.id}`}
          onMoveCard={onMoveCard}
          entityLabel="track"
        />
      </MotionProvider>
    );

    const card = await screen.findByText("Idea Track");
    await act(async () => {
      fireEvent.click(card);
    });

    expect(
      screen.getByRole("button", { name: "Change status" }).textContent
    ).toMatch(/idea/i);

    // Move to Mixing via PeekPanel statusEdit -> status chip updates immediately
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change status" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Mixing" }));
    });

    expect(onMoveCard).toHaveBeenCalledWith(20, 2);
    expect(
      screen.getByRole("button", { name: "Change status" }).textContent
    ).toMatch(/mixing/i);

    // Failed move back to Idea reverts row.status to Mixing
    shouldSucceed = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Change status" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Idea" }));
    });

    expect(
      screen.getByRole("button", { name: "Change status" }).textContent
    ).toMatch(/mixing/i);
  });
});
