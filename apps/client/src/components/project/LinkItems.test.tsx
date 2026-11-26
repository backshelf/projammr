import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";
import type { Link } from "@workspace/api/api";

const patchField = mock(async () => ({}) as unknown);
mock.module("@/actions/patch-field", () => ({ patchField }));

mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children}</a>
  ),
}));

const toastError = mock();
mock.module("sonner", () => ({ toast: { error: toastError } }));

const { default: LinkItems } = await import("./LinkItems");

afterEach(() => {
  cleanup();
  patchField.mockClear();
  toastError.mockClear();
});

const links: Link[] = [
  { name: "Bandcamp", url: "https://demo.bandcamp.com" },
  { name: "Spotify", url: "https://open.spotify.com/demo" },
  { name: "Mirror", url: "https://open.spotify.com/demo" },
];

describe("LinkItems", () => {
  it("gives an editor a named edit and remove button per link, beside its anchor", () => {
    render(<LinkItems links={links} projectId={4} canEdit />);

    for (const { name } of links) {
      expect(screen.getByRole("button", { name: `Edit ${name}` })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: `Remove ${name}` })
      ).toBeTruthy();
    }
    expect(document.querySelectorAll("a button")).toHaveLength(0);
    expect(screen.getAllByRole("link")).toHaveLength(links.length);
  });

  it("gives a viewer the links and no buttons", () => {
    render(<LinkItems links={links} projectId={4} canEdit={false} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getAllByRole("link")).toHaveLength(links.length);
  });

  it("removes only the row asked for when two links share a URL, sending the whole array", async () => {
    const { rerender } = render(
      <LinkItems links={links} projectId={4} canEdit />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Spotify" }));
    });

    expect(patchField).toHaveBeenCalledWith("project", 4, "links", [
      links[0],
      links[2],
    ]);

    // The survivor takes the removed row's key; its bin must still work.
    rerender(
      <LinkItems links={[links[0]!, links[2]!]} projectId={4} canEdit />
    );
    const survivor = screen.getByRole("button", {
      name: "Remove Mirror",
    }) as HTMLButtonElement;
    expect(survivor.disabled).toBe(false);
  });

  it("toasts the error and keeps the row's button usable when the remove fails", async () => {
    patchField.mockResolvedValueOnce({ error: "Nope" });
    render(<LinkItems links={links} projectId={4} canEdit />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Mirror" }));
    });

    expect(toastError).toHaveBeenCalledWith("Nope");
    const button = screen.getByRole("button", {
      name: "Remove Mirror",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("opens the edit dialog prefilled and saves the change in place", async () => {
    render(<LinkItems links={links} projectId={4} canEdit />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Edit Spotify" }));
    });

    expect(screen.getByText("Edit link")).toBeTruthy();
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    const url = screen.getByLabelText("URL") as HTMLInputElement;
    expect(name.value).toBe("Spotify");
    expect(url.value).toBe("https://open.spotify.com/demo");

    fireEvent.change(name, { target: { value: "Spotify HQ" } });
    fireEvent.change(url, { target: { value: "https://spotify.com/hq" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(patchField).toHaveBeenCalledWith("project", 4, "links", [
      links[0],
      { name: "Spotify HQ", url: "https://spotify.com/hq" },
      links[2],
    ]);
  });
});
