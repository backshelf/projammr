import {
  AddLine,
  EmptySection,
  SectionAdd,
  SectionFold,
  useSectionRevealed,
} from "@workspace/ui/components/layout/empty-section";
import { MotionProvider } from "@workspace/ui/components/motion-provider";
import { REVEAL_FOCUS } from "@workspace/ui/lib/reveal-focus";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import type { ReactNode } from "react";

afterEach(cleanup);

function RevealedFlag() {
  return <span>{useSectionRevealed() ? "revealed" : "as loaded"}</span>;
}

function Page({ children }: { children: ReactNode }) {
  return (
    <MotionProvider>
      <SectionFold>
        {children}
        <AddLine label={"Add to this track"} />
      </SectionFold>
    </MotionProvider>
  );
}

const addLine = () => screen.getByRole("group", { name: "Add to this track" });

const lineActions = () =>
  within(addLine())
    .getAllByRole("button")
    .map((button) => button.textContent);

describe("EmptySection", () => {
  it("renders a section with content untouched and keeps it off the add line", () => {
    render(
      <Page>
        <EmptySection label={"ATTACHMENTS"} empty={false} add={"Attachment"}>
          <p>song.wav</p>
          <RevealedFlag />
        </EmptySection>
      </Page>
    );

    expect(screen.getByText("song.wav")).toBeDefined();
    expect(screen.getByText("as loaded")).toBeDefined();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("folds only the empty sections that offer an add into one line, in page order", () => {
    render(
      <Page>
        <EmptySection label={"NOTES"} empty add={"Notes"}>
          <p>editor</p>
        </EmptySection>
        <EmptySection label={"ARTWORK"} empty={false} add={"Artwork"}>
          <p>cover.jpg</p>
        </EmptySection>
        <EmptySection label={"SESSIONS"} empty>
          <p>sessions table</p>
        </EmptySection>
        <EmptySection
          label={"RELATIONS"}
          empty
          addControl={<SectionAdd>Relation</SectionAdd>}
        >
          <p>relations</p>
        </EmptySection>
        <EmptySection label={"ATTACHMENTS"} empty add={"Attachment"}>
          <p>drop zone</p>
        </EmptySection>
      </Page>
    );

    expect(
      screen.getByRole("heading", { name: "Add to this track" })
    ).toBeDefined();
    expect(lineActions()).toEqual([
      "+ Add Notes",
      "+ Add Relation",
      "+ Add Attachment",
    ]);
    expect(screen.getByText("cover.jpg")).toBeDefined();
    expect(screen.queryByText("editor")).toBeNull();
    expect(screen.queryByText("drop zone")).toBeNull();
    expect(screen.queryByRole("heading", { name: "NOTES" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "SESSIONS" })).toBeNull();
  });

  it("renders no add line when no empty section offers an add", () => {
    render(
      <Page>
        <EmptySection label={"NOTES"} empty>
          <p>editor</p>
        </EmptySection>
      </Page>
    );

    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("keeps a section with only an empty label on its own line in place", () => {
    render(
      <Page>
        <EmptySection label={"HISTORY"} empty emptyLabel={"No saves yet"}>
          <p>timeline</p>
        </EmptySection>
      </Page>
    );

    expect(screen.getByRole("heading", { name: "HISTORY" })).toBeDefined();
    expect(screen.getByText("No saves yet")).toBeDefined();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("reveals the section in its place on add, tells it so, focuses its first control and drops the action", async () => {
    render(
      <Page>
        <div data-testid={"sessions-place"}>
          <EmptySection label={"SESSIONS"} empty add={"Session"}>
            <button type={"button"}>Filter</button>
            <RevealedFlag />
          </EmptySection>
        </div>
        <EmptySection label={"ATTACHMENTS"} empty add={"Attachment"}>
          <p>drop zone</p>
        </EmptySection>
      </Page>
    );

    const add = screen.getByRole("button", { name: /Session/ });
    add.focus();
    fireEvent.click(add);

    const place = screen.getByTestId("sessions-place");
    expect(within(place).getByText("revealed")).toBeDefined();
    expect(document.activeElement).toBe(
      within(place).getByRole("button", { name: "Filter" })
    );
    await waitFor(() => {
      expect(lineActions()).toEqual(["+ Add Attachment"]);
    });
  });

  it("keeps a control that took focus as it mounted", () => {
    render(
      <Page>
        <EmptySection label={"SESSIONS"} empty add={"Session"}>
          <button type={"button"}>Filter</button>
          <input aria-label={"Session name"} autoFocus />
        </EmptySection>
      </Page>
    );

    fireEvent.click(screen.getByRole("button", { name: /Session/ }));

    expect(document.activeElement).toBe(
      screen.getByRole("textbox", { name: "Session name" })
    );
  });

  it("waits for the marked region to mount something focusable", async () => {
    function LateEditor() {
      return (
        <div {...REVEAL_FOCUS} data-testid={"editor"}>
          loading
        </div>
      );
    }

    render(
      <Page>
        <EmptySection label={"NOTES"} empty add={"Notes"}>
          <button type={"button"}>Fold</button>
          <LateEditor />
        </EmptySection>
      </Page>
    );

    fireEvent.click(screen.getByRole("button", { name: /Notes/ }));
    expect(document.activeElement).not.toBe(
      screen.getByRole("button", { name: "Fold" })
    );

    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    editable.tabIndex = 0;
    await act(async () => {
      screen.getByTestId("editor").appendChild(editable);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(document.activeElement).toBe(editable);
  });

  it("puts a section that registers late in its page order on the line", () => {
    function TrackPage({ sessionsLoaded }: { sessionsLoaded: boolean }) {
      return (
        <Page>
          <EmptySection label={"NOTES"} empty add={"Notes"}>
            <p>editor</p>
          </EmptySection>
          {sessionsLoaded && (
            <EmptySection label={"SESSIONS"} empty add={"Session"}>
              <p>sessions table</p>
            </EmptySection>
          )}
          <EmptySection label={"ATTACHMENTS"} empty add={"Attachment"}>
            <p>drop zone</p>
          </EmptySection>
        </Page>
      );
    }

    const { rerender } = render(<TrackPage sessionsLoaded={false} />);
    expect(lineActions()).toEqual(["+ Add Notes", "+ Add Attachment"]);

    rerender(<TrackPage sessionsLoaded />);
    expect(lineActions()).toEqual([
      "+ Add Notes",
      "+ Add Session",
      "+ Add Attachment",
    ]);
  });

  it("renders the content and leaves the line once the data fills an empty section", async () => {
    function Links({ empty }: { empty: boolean }) {
      return (
        <Page>
          <EmptySection label={"LINKS"} empty={empty} add={"Link"}>
            <p>Bandcamp</p>
          </EmptySection>
          <EmptySection label={"ATTACHMENTS"} empty add={"Attachment"}>
            <p>drop zone</p>
          </EmptySection>
        </Page>
      );
    }

    const { rerender } = render(<Links empty />);
    expect(screen.queryByText("Bandcamp")).toBeNull();
    expect(lineActions()).toEqual(["+ Add Link", "+ Add Attachment"]);

    rerender(<Links empty={false} />);
    expect(screen.getByText("Bandcamp")).toBeDefined();
    await waitFor(() => {
      expect(lineActions()).toEqual(["+ Add Attachment"]);
    });
  });

  it("reveals the section's children inside an animated wrapper and releases its overflow clip after mount", async () => {
    render(
      <Page>
        <EmptySection label={"SESSIONS"} empty add={"Session"}>
          <p>sessions table</p>
        </EmptySection>
      </Page>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Session/ }));
    });

    const wrapper = screen.getByText("sessions table")
      .parentElement as HTMLElement;
    expect(wrapper.dataset.slot).toBe("revealed-section");

    await waitFor(() => {
      expect(wrapper.style.overflow).toBe("");
    });
  });
});
