import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { LogCommit, LogSave } from "@workspace/ui/lib/commit-log";
import { afterEach, describe, expect, it } from "bun:test";
import { CopyTextProvider } from "@/components/copy-text/CopyTextProvider";
import {
  CommitRowActions,
  commitCompareTip,
  commitDownloadTip,
  RESTORE_UNAVAILABLE,
} from "./CommitRowActions";
import {
  SaveRowActions,
  saveCompareTip,
  saveDownloadTip,
  unavailableReason,
} from "./SaveRowActions";

afterEach(cleanup);

const HISTORY = "/project/1/session/9/history";

const commit: LogCommit = {
  id: 14,
  hash: "a1b2c3d4".padEnd(64, "0"),
  shortId: "a1b2c3d4",
  message: "add strings",
  kind: "user",
  branch: "main",
  committedAt: "2026-06-01T10:00:00.000Z",
  machineName: "studio",
  authorName: "Alex",
  saveId: 40,
  baselineSaveId: 31,
  chips: [],
  chipsKnown: true,
  saves: [],
  samplesReferenced: 0,
  samplesHeld: 0,
  timeInSet: null,
};

const renderCommit = (
  canEdit: boolean,
  over: Partial<LogCommit> = {},
  restoreOn: string | null = null
) =>
  render(
    <CopyTextProvider>
      <CommitRowActions
        commit={{ ...commit, ...over }}
        historyHref={HISTORY}
        canEdit={canEdit}
        restoreOn={restoreOn}
      />
    </CopyTextProvider>
  );

describe("CommitRowActions", () => {
  it("hides Download with samples while the hub holds none, even for viewers", () => {
    renderCommit(false, { samplesReferenced: 3, samplesHeld: 0 });
    expect(screen.queryByRole("link", { name: /with samples/ })).toBeNull();
  });

  it("offers Download with samples once one is held, counting them in its name", () => {
    renderCommit(false, { samplesReferenced: 15, samplesHeld: 12 });
    const link = screen.getByRole("link", { name: /with samples/ });
    expect(link.getAttribute("href")).toBe("/api/commits/14/archive");
    expect(link.getAttribute("aria-label")).toContain(
      "12 of 15 samples included"
    );
  });

  it("compares the commit's save with its parent's and downloads the commit's set", () => {
    renderCommit(true);
    expect(
      screen
        .getByRole("link", { name: "Compare commit a1b2c3d4" })
        .getAttribute("href")
    ).toBe(`${HISTORY}?from=31&to=40`);
    expect(
      screen
        .getByRole("link", { name: /Download set as of commit a1b2c3d4/ })
        .getAttribute("href")
    ).toBe("/api/commits/14/set");
  });

  it("offers Restore to an editor, aria-disabled so keyboard focus still reaches its tooltip", () => {
    renderCommit(true);
    const restore = screen.getByRole("button", {
      name: "Restore on this computer",
    }) as HTMLButtonElement;
    expect(restore.disabled).toBe(false);
    expect(restore.getAttribute("aria-disabled")).toBe("true");
    expect(RESTORE_UNAVAILABLE).toBe("Needs dit on this computer.");
  });

  it("leaves Restore off for a viewer, who still gets the copy command", () => {
    renderCommit(false);
    expect(
      screen.queryByRole("button", { name: "Restore on this computer" })
    ).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Copy dit command for commit a1b2c3d4",
      })
    ).toBeTruthy();
  });

  it("sends a restore for the commit's hub id once a machine tracks the repo", () => {
    renderCommit(true, {}, "studio");
    const restore = screen.getByRole("button", {
      name: "Restore on this computer",
    }) as HTMLButtonElement;
    expect(restore.disabled).toBe(false);
    fireEvent.click(restore);
    expect(window.location.href).toContain("projammr://dit/checkout/14");
  });

  it("shows a viewer no Restore even when a machine tracks the repo", () => {
    renderCommit(false, {}, "studio");
    expect(
      screen.queryByRole("button", { name: "Restore on this computer" })
    ).toBeNull();
  });

  it("tells each action where it acts: the branch and machine of the commit", () => {
    expect(commitDownloadTip(commit)).toBe(
      "Download the set from main · studio"
    );
    expect(commitDownloadTip({ ...commit, machineName: null })).toBe(
      "Download the set from main"
    );
    expect(commitCompareTip(commit)).toBe(
      "Compare with the commit before it on main"
    );
    expect(commitCompareTip({ ...commit, baselineSaveId: null })).toBe(
      "Show what the first commit on main holds"
    );
  });

  it("keeps the page's other parameters on a compare link", () => {
    render(
      <CopyTextProvider>
        <CommitRowActions
          commit={commit}
          historyHref={`${HISTORY}?commits=500`}
          canEdit
          restoreOn={null}
        />
      </CopyTextProvider>
    );
    expect(
      screen
        .getByRole("link", { name: "Compare commit a1b2c3d4" })
        .getAttribute("href")
    ).toBe(`${HISTORY}?commits=500&from=31&to=40`);
  });
});

const save = (contentState: LogSave["contentState"]): LogSave => ({
  id: 7,
  fileUpdatedAt: "2026-06-01T10:00:00.000Z",
  machineName: "studio",
  source: "dit",
  contentState,
  chips: [],
  previousId: 5,
});

describe("SaveRowActions", () => {
  it("downloads a stored save's set and compares it with the save before", () => {
    render(
      <SaveRowActions
        save={save("stored")}
        historyHref={HISTORY}
        retentionDays={90}
      />
    );
    expect(
      screen.getByRole("link", { name: "Download set" }).getAttribute("href")
    ).toBe("/api/saves/7/set");
    expect(
      screen.getByRole("link", { name: "Compare" }).getAttribute("href")
    ).toBe(`${HISTORY}?from=5&to=7`);
  });

  it("disables the download of a pruned save yet keeps it focusable and comparable", () => {
    render(
      <SaveRowActions
        save={save("pruned")}
        historyHref={HISTORY}
        retentionDays={90}
      />
    );
    const button = screen.getByRole("button", {
      name: "Download set, unavailable",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("link", { name: "Compare" })).toBeTruthy();
  });

  it("tells each action where it acts: the machine the set was saved on", () => {
    expect(saveDownloadTip(save("stored"))).toBe(
      "Download the set saved on studio"
    );
    expect(saveDownloadTip({ ...save("stored"), machineName: null })).toBe(
      "Download the set of this save"
    );
    expect(saveCompareTip(save("stored"))).toBe(
      "Compare with the save before it"
    );
    expect(saveCompareTip({ ...save("stored"), previousId: null })).toBe(
      "Show what this save holds"
    );
  });

  it("keeps the page's other parameters on a compare link", () => {
    render(
      <SaveRowActions
        save={save("stored")}
        historyHref={`${HISTORY}?commits=500&checkpoints=1`}
        retentionDays={90}
      />
    );
    expect(
      screen.getByRole("link", { name: "Compare" }).getAttribute("href")
    ).toBe(`${HISTORY}?commits=500&checkpoints=1&from=5&to=7`);
  });

  it("names the retention days in the pruned message", () => {
    expect(unavailableReason("pruned", 90)).toBe(
      "Content of uncommitted saves is kept for 90 days; this one has expired."
    );
    expect(unavailableReason("pruned", 30)).toContain("30 days");
    expect(unavailableReason("stored", 90)).toBeNull();
    expect(unavailableReason("none", 90)).toContain("without its content");
  });
});
