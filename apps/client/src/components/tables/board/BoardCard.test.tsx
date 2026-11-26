import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";

import { BoardCard } from "./BoardCard";

const renderCard = (card: Parameters<typeof BoardCard>[0]["card"]) =>
  render(<BoardCard card={card} columnId={1} onOpen={() => {}} />);

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
});
