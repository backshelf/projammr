import type { ActionError } from "@workspace/api/api";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const refresh = mock();

mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

const { LinkPickerDialog } = await import("./LinkPickerDialog");

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

type Row = { id: number; title: string };

const row: Row = { id: 1, title: "Kickdrum" };

const renderDialog = (link: (item: Row) => Promise<Row | ActionError>) =>
  render(
    <LinkPickerDialog
      open
      onOpenChange={() => {}}
      title="Link a row"
      description="Pick one."
      load={async () => ({ items: [row] })}
      matches={(item, q) => item.title.toLowerCase().includes(q)}
      renderRow={(item) => <span>{item.title}</span>}
      placeholder="Search…"
      emptyLabel="Nothing to link."
      link={link}
      linkedLabel={(item) => `Linked "${item.title}"`}
    />
  );

describe("EntityPicker / LinkPickerDialog refresh", () => {
  it("a successful pick asks the router for no refresh of its own", async () => {
    const link = mock(async (item: Row) => item);
    renderDialog(link);

    const button = await screen.findByRole("button", { name: row.title });
    fireEvent.click(button);

    await waitFor(() => expect(link).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(0);
  });

  it("a failed pick refreshes nothing", async () => {
    const link = mock(async () => ({ error: "Failed to link" }) as ActionError);
    renderDialog(link);

    const button = await screen.findByRole("button", { name: row.title });
    fireEvent.click(button);

    await waitFor(() => expect(link).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalledTimes(0);
  });
});
