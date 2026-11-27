import { escapeHtml, renderDialog } from "./shared.js";

export interface CommitDialogData {
  setName: string;
  branch: string;
  savesSinceCommit: number;
  workingChanged: boolean;
  firstCommit: boolean;
  suggestedMessage: string;
  error: string | null;
  ditRunning: boolean;
}

export type CommitDialogResult =
  | { action: "cancel" }
  | { action: "open-panel" }
  | { action: "commit"; message: string; noPush: boolean };

export function buildCommitDialog(data: CommitDialogData): string {
  const canCommit = data.ditRunning && !data.error && data.workingChanged;
  const statusLine = data.error
    ? `<p class="status-line problem">${escapeHtml(data.error)}</p>`
    : data.workingChanged
      ? `<p class="status-line">${data.savesSinceCommit} save${data.savesSinceCommit === 1 ? "" : "s"} since last commit.</p>`
      : `<p class="status-line">Nothing to commit on disk yet. Save in Live (⌘S) first.</p>`;

  return renderDialog({
    title: `Commit · ${data.setName}`,
    initialData: data,
    body: `
      <div class="head">
        <h1>${escapeHtml(data.setName)}</h1>
        <div class="sub">${escapeHtml(data.branch)}</div>
      </div>
      ${statusLine}
      ${
        canCommit
          ? `
        <div class="field">
          <label class="section-label" for="message">Commit message</label>
          <textarea id="message" rows="2" placeholder="${data.firstCommit ? "Initial commit" : "What changed"}">${escapeHtml(data.suggestedMessage)}</textarea>
        </div>
        <label class="check">
          <input id="noPush" type="checkbox" />
          <span>Keep local only (--no-push)</span>
        </label>
      `
          : ""
      }
      <div class="spacer"></div>
      <div class="actions">
        <button id="openPanel" class="ghost actions-left" ${data.ditRunning ? "" : "disabled"}>Open dit panel ↗</button>
        <button id="cancel" class="ghost">${canCommit ? "Cancel" : "Close"}</button>
        ${
          canCommit
            ? `<button id="submit" class="primary">Commit <span class="kbd">⌘↩</span></button>`
            : ""
        }
      </div>
    `,
    script: `
      const input = document.getElementById("message");
      const noPush = document.getElementById("noPush");
      const submit = document.getElementById("submit");
      if (input) {
        input.focus();
        input.select();
      }
      function doCommit() {
        if (!submit || submit.disabled) return;
        closeWithResult({
          action: "commit",
          message: input ? input.value.trim() : "",
          noPush: Boolean(noPush && noPush.checked),
        });
      }
      if (submit) submit.addEventListener("click", doCommit);
      document.getElementById("cancel").addEventListener("click", () => closeWithResult({ action: "cancel" }));
      document.getElementById("openPanel").addEventListener("click", () => closeWithResult({ action: "open-panel" }));
      if (input) {
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            doCommit();
          }
        });
      }
    `,
  });
}
