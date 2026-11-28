import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { Status } from "@workspace/api/api";

import { BoardCard } from "./BoardCard";

afterEach(cleanup);

const STATUSES: Status[] = [
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

const renderCard = (
  card: Parameters<typeof BoardCard>[0]["card"],
  extra: Partial<Parameters<typeof BoardCard>[0]> = {}
) =>
  render(<BoardCard card={card} columnId={1} onOpen={() => {}} {...extra} />);

describe("BoardCard", () => {
  test("flags an archived card", () => {
    renderCard({ id: 1, title: "Demo", archived: true });
    expect(screen.getByText("Archived")).toBeTruthy();
  });

  test("shows no flag on a live card", () => {
    renderCard({ id: 2, title: "Demo", archived: false });
    expect(screen.queryByText("Archived")).toBeNull();
  });

  test("shows no flag when the card does not say", () => {
    renderCard({ id: 3, title: "Demo" });
    expect(screen.queryByText("Archived")).toBeNull();
  });

  test("puts touch-action none on the drag handle only and offers Move to menu", async () => {
    const onMoveTo = mock();
    const { container } = renderCard(
      {
        id: 4,
        title: "Drift",
        priority: {
          id: 1,
          name: "None",
          colour: "var(--ink-soft)",
          rank: 0,
        } as never,
      },
      { moveTargets: STATUSES, onMoveTo }
    );

    expect(screen.queryByText("None")).toBeNull();

    const handle = screen.getByRole("button", { name: "Drag Drift" });
    expect(handle.style.touchAction).toBe("none");
    expect(
      (container.firstElementChild as HTMLElement).style.touchAction
    ).not.toBe("none");

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Actions for Drift" })
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: /mixing/i }));
    });
    expect(onMoveTo).toHaveBeenCalledWith(4, 2);
  });
});
