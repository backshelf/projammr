import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { DEFAULT_POLICIES } from "@/lib/policies/policies";
import { PoliciesProvider } from "@/lib/policies/provider";
import type { CommentWithReplies } from "@workspace/api/api";
import type { CommentBackend } from "./comment-backend";

const toastError = mock();

mock.module("@/actions/comments", () => ({
  createComment: mock(),
  deleteComment: mock(),
  getCommentsForTarget: mock(),
  reopenComment: mock(),
  resolveComment: mock(),
  updateComment: mock(),
}));
mock.module("sonner", () => ({ toast: { error: toastError } }));

const { CommentBackendProvider } = await import("./comment-backend");
const { default: CommentList } = await import("./CommentList");

const author = { id: "u1", name: "Ada Lovelace" };

const row = (
  over: Partial<CommentWithReplies> & { id: number }
): CommentWithReplies =>
  ({
    content: `body ${over.id}`,
    targetType: "track_audio",
    targetId: 5,
    parentId: null,
    positionMs: null,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    resolver: null,
    user: author,
    viewerCan: { amend: false, resolve: true },
    replies: [],
    ...over,
  }) as unknown as CommentWithReplies;

const reply = (over: Partial<CommentWithReplies> & { id: number }) =>
  row({
    parentId: 1,
    viewerCan: { amend: true, resolve: false },
    ...over,
  });

const resolver = { id: "u2", name: "Grace Hopper" };

const settled = (over: Partial<CommentWithReplies> = {}) =>
  row({
    id: 1,
    resolvedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    resolvedBy: resolver.id,
    resolver,
    ...over,
  } as Partial<CommentWithReplies> & { id: number });

const ok = { id: 1 };

const stubBackend = (over: Partial<CommentBackend> = {}) =>
  ({
    list: mock(),
    create: mock(),
    update: mock(),
    remove: mock(),
    resolve: mock(async () => ok),
    reopen: mock(async () => ok),
    ...over,
  }) as unknown as CommentBackend;

const renderList = (
  comments: CommentWithReplies[],
  backend: CommentBackend,
  onChange?: () => void
) =>
  render(
    <CommentBackendProvider backend={backend}>
      <CommentList comments={comments} onChange={onChange} />
    </CommentBackendProvider>
  );

beforeEach(() => toastError.mockClear());
afterEach(cleanup);

describe("CommentList resolve control", () => {
  it("offers Resolve on a root row the server says may be resolved", () => {
    renderList([row({ id: 1 })], stubBackend());

    const button = screen.getByRole("button", { name: "Resolve" });
    // The verb carries the state, so the button is not also a pressed toggle.
    expect(button.hasAttribute("aria-pressed")).toBe(false);
  });

  it("offers no control when the resolve flag is false", () => {
    renderList(
      [row({ id: 1, viewerCan: { amend: true, resolve: false } })],
      stubBackend()
    );

    expect(screen.queryByRole("button", { name: "Resolve" })).toBeNull();
  });

  it("offers no control on a backend without resolve, and still shows the state", () => {
    renderList(
      [settled()],
      stubBackend({ resolve: undefined, reopen: undefined })
    );

    expect(screen.queryByRole("button", { name: /Resolve|Reopen/ })).toBeNull();
    expect(screen.getByText(/^Resolved · Grace Hopper · /)).toBeTruthy();
  });

  it("never offers the control on a reply", () => {
    renderList(
      // The reply's own flag says yes, so only the row's reply guard keeps the control away.
      [
        row({
          id: 1,
          replies: [
            reply({ id: 2, viewerCan: { amend: true, resolve: true } }),
          ],
        }),
      ],
      stubBackend({ viewerId: null })
    );

    expect(screen.getAllByRole("button", { name: "Resolve" })).toHaveLength(1);
  });

  it("shows the stamp and Reopen on a resolved row", () => {
    renderList([settled()], stubBackend());

    expect(screen.getByText(/^Resolved · Grace Hopper · .*ago$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reopen" })).toBeTruthy();
  });

  it("names an unknown resolver when the account is gone", () => {
    renderList([settled({ resolver: null })], stubBackend());

    expect(screen.getByText(/^Resolved · Unknown · /)).toBeTruthy();
  });

  it("calls resolve then refreshes when Resolve is clicked", async () => {
    const backend = stubBackend();
    const onChange = mock();
    renderList([row({ id: 1 })], backend, onChange);

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(backend.resolve).toHaveBeenCalledWith(1);
    expect(backend.reopen).not.toHaveBeenCalled();
  });

  it("calls reopen when Reopen is clicked", async () => {
    const backend = stubBackend();
    const onChange = mock();
    renderList([settled()], backend, onChange);

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(backend.reopen).toHaveBeenCalledWith(1);
    expect(backend.resolve).not.toHaveBeenCalled();
  });

  it("toasts the message and leaves the row as it was when the toggle fails", async () => {
    const backend = stubBackend({
      resolve: mock(async () => ({ error: "Nope" })),
    });
    const onChange = mock();
    renderList([row({ id: 1 })], backend, onChange);

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Nope"));
    expect(onChange).not.toHaveBeenCalled();
    const button = screen.getByRole("button", { name: "Resolve" });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/^Resolved/)).toBeNull();
  });
});

describe("CommentList under a resolved thread", () => {
  it("softens the reply's name and keeps its own Edit and Delete", () => {
    renderList(
      [
        settled({
          replies: [
            reply({ id: 2, user: { id: "u3", name: "Linus" } as never }),
          ],
        }),
      ],
      stubBackend()
    );

    expect(screen.getByText("Linus").className).toContain("text-ink-soft");
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(screen.getAllByText(/^Resolved ·/)).toHaveLength(1);
  });

  it("keeps the author's name in full ink until the thread is resolved", () => {
    renderList([row({ id: 1 })], stubBackend());

    const authorEl = screen.getByText("Ada Lovelace");
    expect(authorEl.className).toContain("text-ink");
    expect(authorEl.className).not.toContain("text-ink-soft");
    expect(authorEl.parentElement?.className).toContain("flex-wrap");
  });
});

describe("CommentList delete", () => {
  const amendable = () =>
    row({ id: 1, viewerCan: { amend: true, resolve: false } } as never);
  const deleted = async () => ({ deleted: true });

  it("asks first, and deletes only once the confirm is pressed", async () => {
    const backend = stubBackend({ remove: mock(deleted) });
    const onChange = mock();
    renderList([amendable()], backend, onChange);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText("Delete this comment?")).toBeTruthy();
    expect(backend.remove).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(confirm).getByRole("button", { name: "Delete" }));
    });

    expect(backend.remove).toHaveBeenCalledWith(1);
    expect(onChange).toHaveBeenCalled();
  });

  it("deletes nothing when the confirm is cancelled", async () => {
    const backend = stubBackend();
    renderList([amendable()], backend);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(backend.remove).not.toHaveBeenCalled();
  });

  it("deletes at once, unasked, when comment confirms are off", async () => {
    const backend = stubBackend({ remove: mock(deleted) });
    render(
      <PoliciesProvider
        policies={{
          ...DEFAULT_POLICIES,
          feedback: {
            ...DEFAULT_POLICIES.feedback,
            confirmDeletes: {
              ...DEFAULT_POLICIES.feedback.confirmDeletes,
              comment: false,
            },
          },
        }}
      >
        <CommentBackendProvider backend={backend}>
          <CommentList comments={[amendable()]} />
        </CommentBackendProvider>
      </PoliciesProvider>
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    });

    expect(backend.remove).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
