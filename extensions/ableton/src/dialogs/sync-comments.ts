import { escapeHtml, renderDialog } from "./shared.js";

export interface SyncCommentCandidate {
  id: number;
  label: string;
  beat: number;
  barLabel: string;
  timecode: string;
  alreadyExists: boolean;
}

export interface SyncCommentsDialogData {
  setName: string;
  targetLabel: string | null;
  tempo: number;
  items: SyncCommentCandidate[];
  error: string | null;
}

export type SyncCommentsDialogResult =
  | { action: "cancel" }
  | { action: "sync"; selectedIds: number[] };

export function buildSyncCommentsDialog(data: SyncCommentsDialogData): string {
  const newCount = data.items.filter((item) => !item.alreadyExists).length;
  const subParts = [
    data.targetLabel,
    `${Math.round(data.tempo * 100) / 100} BPM`,
  ].filter(Boolean);

  let content: string;
  if (data.error) {
    content = `<p class="status-line problem">${escapeHtml(data.error)}</p>`;
  } else if (data.items.length === 0) {
    content = `<p class="status-line">No open timestamped comments on ${escapeHtml(data.targetLabel ?? "this session")}.</p>`;
  } else {
    const rows = data.items
      .map(
        (item) => `
          <label class="item">
            <input
              type="checkbox"
              class="comment-check"
              value="${item.id}"
              ${item.alreadyExists ? "disabled" : "checked"}
            />
            <div class="item-body">
              <div class="item-title">${escapeHtml(item.label)}</div>
              <div class="item-meta">${escapeHtml(item.timecode)} → Bar ${escapeHtml(item.barLabel)}${item.alreadyExists ? " · already in Live" : ""}</div>
            </div>
          </label>
        `
      )
      .join("");
    content = `
      <div class="section-label">Comments</div>
      <div class="list">${rows}</div>
    `;
  }

  return renderDialog({
    title: `Comments · ${data.setName}`,
    initialData: data,
    body: `
      <div class="head">
        <h1>${escapeHtml(data.setName)}</h1>
        <div class="sub">${escapeHtml(subParts.join(" · "))}</div>
      </div>
      ${content}
      <div class="spacer"></div>
      <div class="actions">
        <button id="cancel" class="ghost">${newCount > 0 ? "Cancel" : "Close"}</button>
        ${
          newCount > 0
            ? `<button id="sync" class="primary">Add ${newCount} cue point${newCount === 1 ? "" : "s"}</button>`
            : ""
        }
      </div>
    `,
    script: `
      document.getElementById("cancel").addEventListener("click", () => closeWithResult({ action: "cancel" }));
      const syncBtn = document.getElementById("sync");
      if (syncBtn) {
        const checks = Array.from(document.querySelectorAll(".comment-check:not(:disabled)"));
        function updateCount() {
          const count = checks.filter((el) => el.checked).length;
          syncBtn.disabled = count === 0;
          syncBtn.textContent = count === 0
            ? "Select comments"
            : "Add " + count + " cue point" + (count === 1 ? "" : "s");
        }
        for (const el of checks) el.addEventListener("change", updateCount);
        updateCount();
        syncBtn.addEventListener("click", () => {
          const selectedIds = checks
            .filter((el) => el.checked)
            .map((el) => Number.parseInt(el.value, 10))
            .filter((n) => Number.isFinite(n));
          closeWithResult({ action: "sync", selectedIds });
        });
      }
    `,
  });
}
