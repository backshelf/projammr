import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

type Result = { data?: unknown; error?: unknown; response: Response };
const GET = mock<(path: string, init: unknown) => Promise<Result>>();
mock.module("@/lib/browser-api", () => ({ browserApi: { GET } }));

const { MotionProvider } =
  await import("@workspace/ui/components/motion-provider");
const { CHANGES_PAGE, RecentChanges } = await import("./RecentChanges");
type SettingsAuditEntry = import("@workspace/api/api").SettingsAuditEntry;

const ok = (data: unknown): Result => ({
  data,
  response: new Response(null, { status: 200 }),
});

const MIRA = { id: "u1", name: "Mira Chen" };
const HOUR = 60 * 60 * 1000;

const entry = (
  id: number,
  change: Partial<SettingsAuditEntry> = {}
): SettingsAuditEntry => ({
  id,
  scope: "instance",
  scopeId: null,
  key: "instance-access.registration",
  old: "open",
  new: "closed",
  lockedBefore: false,
  lockedAfter: false,
  at: new Date(Date.now() - id * HOUR).toISOString(),
  actor: MIRA,
  ...change,
});

/** The query of the `index`th read of the audit. */
const asked = (index: number) =>
  (GET.mock.calls[index]?.[1] as { params: { query: Record<string, unknown> } })
    .params.query;

function open(target: Parameters<typeof RecentChanges>[0]["target"]) {
  render(<RecentChanges target={target} />, { wrapper: MotionProvider });
  fireEvent.click(screen.getByRole("button", { name: "Recent changes" }));
}

// Plain DOM and text queries: a role query over a full page of entries is
// slow enough under happy-dom to run a test out of time.
const lines = () =>
  [...document.querySelectorAll("li")].map((item) => item.textContent ?? "");

/** The list's paging button, by the words it shows. */
const pager = (words: string) =>
  screen.queryByText(words, { selector: "button" });

/** The message a failed page leaves. */
const alertText = () =>
  document.querySelector('[role="alert"]')?.textContent ?? null;

beforeEach(() => GET.mockReset());
afterEach(cleanup);

describe("RecentChanges", () => {
  it("reads nothing until it is opened", () => {
    render(<RecentChanges target={{ scope: "instance", id: "instance" }} />, {
      wrapper: MotionProvider,
    });

    expect(GET).not.toHaveBeenCalled();
  });

  it("reads a write through its control, a lock change, and a removed account's change", async () => {
    GET.mockResolvedValue(
      ok([
        entry(1),
        entry(2, {
          key: "editor.rhymePrefix",
          old: "\\",
          new: "\\",
          lockedBefore: false,
          lockedAfter: true,
        }),
        entry(3, {
          key: "editor.synonymPrefix",
          old: null,
          new: "~~",
          lockedBefore: false,
          lockedAfter: true,
        }),
        entry(4, { actor: null, old: "closed", new: null }),
        entry(5, { key: "player.removed", old: 1, new: 2 }),
      ])
    );

    open({ scope: "instance", id: "instance" });

    await waitFor(() => expect(lines()).toHaveLength(5));
    expect(GET.mock.calls[0]?.[0]).toBe("/api/settings/audit");
    expect(asked(0)).toEqual({
      scope: "instance",
      id: "instance",
      limit: CHANGES_PAGE,
    });
    const [write, lock, lockWithValue, removed, unknown] = lines();
    expect(write).toContain("Mira Chen · Registration · Open → to Invite only");
    expect(write).toContain("1 hour ago");
    expect(lock).toContain("Mira Chen · Rhyme prefix · locked");
    expect(lock).not.toContain("→");
    expect(lockWithValue).toContain(
      "Synonym prefix · locked · (not set) → to “~~”"
    );
    expect(removed).toContain(
      "a removed account · Registration · Invite only → to (not set)"
    );
    expect(unknown).toContain("player.removed · 1 → to 2");
  });

  it("reads an unlock", async () => {
    GET.mockResolvedValue(
      ok([
        entry(1, {
          key: "editor.rhymePrefix",
          old: "\\",
          new: "\\",
          lockedBefore: true,
          lockedAfter: false,
        }),
      ])
    );

    open({ scope: "project", id: 7 });

    await waitFor(() =>
      expect(lines()[0]).toContain("Rhyme prefix · unlocked")
    );
    expect(asked(0)).toEqual({
      scope: "project",
      id: "7",
      limit: CHANGES_PAGE,
    });
  });

  it("pages back through older changes by the last one shown, until there are no more", async () => {
    const first = Array.from({ length: CHANGES_PAGE }, (_, index) =>
      entry(index + 1)
    );
    GET.mockResolvedValueOnce(ok(first)).mockResolvedValueOnce(
      ok([entry(CHANGES_PAGE + 1, { actor: { id: "u2", name: "Theo" } })])
    );

    open({ scope: "instance", id: "instance" });
    await waitFor(() => expect(pager("Show more")).not.toBe(null));
    fireEvent.click(pager("Show more")!);

    await waitFor(() => expect(lines()).toHaveLength(CHANGES_PAGE + 1));
    expect(asked(1)).toEqual({
      scope: "instance",
      id: "instance",
      limit: CHANGES_PAGE,
      before: CHANGES_PAGE,
    });
    expect(lines().at(-1)).toContain("Theo");
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "1 more change"
    );
    // A page shorter than a full one was the last.
    expect(pager("Show more")).toBe(null);
  });

  it("keeps what it shows when an older page fails, and tries that page again", async () => {
    GET.mockResolvedValueOnce(
      ok(Array.from({ length: CHANGES_PAGE }, (_, index) => entry(index + 1)))
    )
      .mockResolvedValueOnce({
        error: { error: "Service unavailable" },
        response: new Response(null, { status: 503 }),
      })
      .mockResolvedValueOnce(ok([]));

    open({ scope: "instance", id: "instance" });
    await waitFor(() => expect(pager("Show more")).not.toBe(null));
    fireEvent.click(pager("Show more")!);

    await waitFor(() =>
      expect(alertText()).toBe("Couldn't load more. Service unavailable")
    );
    expect(lines()).toHaveLength(CHANGES_PAGE);

    fireEvent.click(pager("Try again")!);

    await waitFor(() => expect(GET).toHaveBeenCalledTimes(3));
    expect(asked(2)).toMatchObject({ before: CHANGES_PAGE });
    await waitFor(() => expect(pager("Try again")).toBe(null));
    expect(pager("Show more")).toBe(null);
    expect(alertText()).toBe(null);
    expect(lines()).toHaveLength(CHANGES_PAGE);
  });

  it("says so when there are no changes yet, and offers a retry when the first page fails", async () => {
    GET.mockResolvedValueOnce({
      error: { error: "Not found" },
      response: new Response(null, { status: 404 }),
    }).mockResolvedValueOnce(ok([]));

    open({ scope: "instance", id: "instance" });

    await waitFor(() =>
      expect(alertText()).toBe("Couldn't load the recent changes. Not found")
    );

    fireEvent.click(pager("Try again")!);

    expect(
      await screen.findByText("Nothing has changed here yet.", { exact: false })
    ).toBeTruthy();
  });
});
