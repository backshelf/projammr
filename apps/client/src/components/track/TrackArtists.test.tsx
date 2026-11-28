import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, mock } from "bun:test";

const refresh = mock();
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

mock.module("sonner", () => ({ toast: { error: mock() } }));

// next/link updates state as it mounts, outside any act() the test can wrap.
mock.module("@/components/navigation/AppLink", () => ({
  AppLink: ({ href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props} />
  ),
}));

const { defineMutation } = await import("@/lib/mutation");
const patchEntityFields = mock(
  (_kind: string, _id: number, body: Record<string, unknown>) =>
    defineMutation(async () => body, ["route"])
);
mock.module("@/entities/mutations", () => ({ patchEntityFields }));

const { ProjectProvider } = await import("@/hooks/use-project-role");
const { TrackArtists } = await import("./TrackArtists");

afterEach(() => {
  cleanup();
  refresh.mockClear();
  patchEntityFields.mockClear();
});

const VOCABULARY = ["Ada Vale", "Juno Park", "Marlow Reed"];

function renderArtists(artists: string[], vocabulary?: string[]) {
  return render(
    <ProjectProvider project={{ id: 3, name: "Project", role: "editor" }}>
      <TrackArtists
        trackId={9}
        artists={artists}
        vocabulary={vocabulary && Promise.resolve(vocabulary)}
      />
    </ProjectProvider>
  );
}

const savedArtists = () =>
  patchEntityFields.mock.calls.map(([, , body]) => body.artists);

describe("TrackArtists", () => {
  it("links each artist to the tracks list filtered to that artist", () => {
    renderArtists(["Ada Vale", "Juno Park"]);

    expect(
      screen.getByRole("link", { name: "Ada Vale" }).getAttribute("href")
    ).toBe("/project/3/track/all?artist=Ada+Vale");
    expect(
      screen.getByRole("link", { name: "Juno Park" }).getAttribute("href")
    ).toBe("/project/3/track/all?artist=Juno+Park");
    // No vocabulary means no edit rights: the artists are links only.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing for an uncredited track the viewer cannot edit", () => {
    const { container } = renderArtists([]);
    expect(container.textContent).toBe("");
  });

  it("credits a suggested artist, a typed one in the project's spelling, and uncredits one", async () => {
    // The route refresh is stubbed, so each write starts again from the
    // server's credits once the one before it settles.
    renderArtists(["Ada Vale"], VOCABULARY);

    const edit = screen.getByRole("button", { name: "Edit artists" });
    await act(async () => fireEvent.click(edit));
    const juno = await screen.findByRole("option", { name: "Juno Park" });
    await act(async () => fireEvent.click(juno));

    const input = screen.getByRole("textbox", { name: /add artist/i });
    fireEvent.change(input, { target: { value: "marlow REED" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));

    const remove = screen.getByRole("button", { name: "Remove Ada Vale" });
    await act(async () => fireEvent.click(remove));

    expect(savedArtists()).toEqual([
      ["Ada Vale", "Juno Park"],
      ["Ada Vale", "Marlow Reed"],
      [],
    ]);
  });

  it("offers to add an artist to an uncredited track", async () => {
    renderArtists([], VOCABULARY);

    const open = screen.getByRole("button", { name: "Add artists" });
    await act(async () => fireEvent.click(open));
    fireEvent.change(
      await screen.findByRole("textbox", { name: /add artist/i }),
      { target: { value: "Iris Hale" } }
    );
    const add = screen.getByRole("button", { name: "Add “Iris Hale”" });
    await act(async () => fireEvent.click(add));

    expect(savedArtists()).toEqual([["Iris Hale"]]);
  });
});
