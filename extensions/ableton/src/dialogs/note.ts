import { escapeHtml, renderDialog } from "./shared.js";

export interface NoteDialogData {
  setName: string;
  trackNames: string[];
  barRange: string;
  timeRange: string;
  positionMs: number;
  canPostToProjammr: boolean;
  projammrTargetLabel: string | null;
  projammrReason: string | null;
}

export type NoteDialogResult =
  | { action: "cancel" }
  | {
      action: "submit";
      content: string;
      addCuePoint: boolean;
      postToProjammr: boolean;
    };

export function buildNoteDialog(data: NoteDialogData): string {
  const tracksLabel =
    data.trackNames.length > 0 ? data.trackNames.join(", ") : "Arrangement";
  const cueBar = data.barRange.split("–")[0] ?? data.barRange;

  return renderDialog({
    title: `Note · ${data.barRange}`,
    initialData: data,
    body: `
      <div class="head">
        <h1>${escapeHtml(data.setName)}</h1>
        <div class="sub">${escapeHtml(tracksLabel)} · ${escapeHtml(data.barRange)} · ${escapeHtml(data.timeRange)}</div>
      </div>
      <div class="field">
        <label class="section-label" for="content">Note</label>
        <textarea id="content" rows="3" placeholder="e.g. Bring snare up 1 dB on the chorus pickup"></textarea>
      </div>
      <div class="checks">
        <label class="check">
          <input id="addCuePoint" type="checkbox" checked />
          <span>Add Live cue point at ${escapeHtml(cueBar)}</span>
        </label>
        ${
          data.canPostToProjammr
            ? `
          <label class="check">
            <input id="postToProjammr" type="checkbox" checked />
            <span>Post to Projammr (${escapeHtml(data.projammrTargetLabel ?? "session")})</span>
          </label>
        `
            : `<p class="status-line">${escapeHtml(data.projammrReason ?? "Projammr isn\u2019t connected.")}</p>`
        }
      </div>
      <div class="spacer"></div>
      <div class="actions">
        <button id="cancel" class="ghost">Cancel</button>
        <button id="submit" class="primary">Save <span class="kbd">⌘↩</span></button>
      </div>
    `,
    script: `
      const textarea = document.getElementById("content");
      const addCuePoint = document.getElementById("addCuePoint");
      const postToProjammr = document.getElementById("postToProjammr");
      const submit = document.getElementById("submit");
      textarea.focus();
      function syncSubmitState() {
        const hasDestination = Boolean(addCuePoint.checked) || Boolean(postToProjammr && postToProjammr.checked);
        submit.disabled = !hasDestination;
      }
      addCuePoint.addEventListener("change", syncSubmitState);
      if (postToProjammr) postToProjammr.addEventListener("change", syncSubmitState);
      syncSubmitState();
      function doSubmit() {
        if (submit.disabled) return;
        const content = textarea.value.trim();
        if (!content) {
          textarea.focus();
          return;
        }
        closeWithResult({
          action: "submit",
          content,
          addCuePoint: Boolean(addCuePoint.checked),
          postToProjammr: Boolean(postToProjammr && postToProjammr.checked),
        });
      }
      submit.addEventListener("click", doSubmit);
      document.getElementById("cancel").addEventListener("click", () => closeWithResult({ action: "cancel" }));
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          doSubmit();
        }
      });
    `,
  });
}
