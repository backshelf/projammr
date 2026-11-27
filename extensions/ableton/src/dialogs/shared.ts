/**
 * Shared Projammr / `dit` modal webview shell following `DESIGN.md`:
 * true-neutral paper & ink, self-hosted Redaction 35 / Spline Sans Mono / Departure Mono,
 * hairline structure, left-rule status lines, and WebKit/WebView2 `close_and_send` bridge.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  departureMono,
  redaction35,
  splineSansMono,
  splineSansMono500,
} from "@projammr/fonts";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeJson(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}

/**
 * Serves the dialog HTML via a temp `file://` URL when available (fast, no giant data-URL encoding),
 * falling back to a UTF-8 `data:text/html` URL.
 */
export function dialogUrl(
  html: string,
  tempDirectory: string | undefined,
  name: string
): string {
  if (tempDirectory) {
    try {
      fs.mkdirSync(tempDirectory, { recursive: true });
      const file = path.join(tempDirectory, `${name}.html`);
      fs.writeFileSync(file, html, "utf8");
      return pathToFileURL(file).href;
    } catch {
      // Fall back to data URL
    }
  }
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function renderDialog<T>(options: {
  title: string;
  body: string;
  script: string;
  initialData: T;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title)}</title>
  <style>
    @font-face {
      font-family: "Redaction 35";
      src: url("${redaction35}") format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
    @font-face {
      font-family: "Departure Mono";
      src: url("${departureMono}") format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
    @font-face {
      font-family: "Spline Sans Mono";
      src: url("${splineSansMono}") format("woff2");
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
    @font-face {
      font-family: "Spline Sans Mono";
      src: url("${splineSansMono500}") format("woff2");
      font-weight: 500;
      font-style: normal;
      font-display: block;
    }

    *, *::before, *::after { box-sizing: border-box; }
    *:not(dialog) { margin: 0; }
    input, textarea, button { font: inherit; color: inherit; }

    /* Projammr token spine (DESIGN.md / packages/ui/src/styles/foundation.css) */
    :root {
      color-scheme: light;
      --paper: oklch(0.995 0 0);
      --paper-sunk: oklch(0.965 0 0);
      --ink: oklch(0.09 0 0);
      --ink-soft: oklch(0.44 0 0);
      --ink-faint: oklch(0.63 0 0);
      --rule: oklch(0.89 0 0);
      --rule-strong: oklch(0.78 0 0);
      --danger: oklch(0.52 0.22 27);
      --radius-sm: 0.27rem;
      --radius-md: 0.36rem;
      --font-heading: "Redaction 35", Georgia, serif;
      --font-sub: "Departure Mono", ui-monospace, monospace;
      --font-mono: "Spline Sans Mono", ui-monospace, monospace;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --paper: oklch(0.135 0 0);
        --paper-sunk: oklch(0.105 0 0);
        --ink: oklch(0.99 0 0);
        --ink-soft: oklch(0.68 0 0);
        --ink-faint: oklch(0.48 0 0);
        --rule: oklch(1 0 0 / 11%);
        --rule-strong: oklch(1 0 0 / 22%);
        --danger: oklch(0.7 0.19 22);
      }
    }

    html, body {
      height: 100%;
      background: var(--paper);
      color: var(--ink);
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    body {
      padding: 18px 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .head {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    h1 {
      font-family: var(--font-heading);
      font-size: 26px;
      font-weight: 400;
      line-height: 1.05;
      letter-spacing: -0.01em;
      color: var(--ink);
      overflow-wrap: anywhere;
    }

    .sub {
      color: var(--ink-soft);
      font-size: 12px;
    }

    .section-label {
      font-family: var(--font-sub);
      font-size: 11px;
      font-weight: 400;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--ink-soft);
    }

    /* Matches dit-app StatusLines: quiet note beside a hairline, never a boxed card. */
    .status-line {
      border-left: 1px solid var(--rule-strong);
      padding-left: 12px;
      color: var(--ink-soft);
      font-size: 12px;
      text-wrap: pretty;
    }

    .status-line.problem {
      border-left-color: var(--danger);
      color: var(--danger);
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    input[type="text"], textarea {
      width: 100%;
      background: transparent;
      color: var(--ink);
      border: 1px solid var(--rule);
      border-radius: var(--radius-md);
      padding: 7px 9px;
      font-size: 12px;
      line-height: 1.5;
      outline: none;
      transition: border-color 120ms ease;
    }

    input[type="text"]::placeholder, textarea::placeholder {
      color: var(--ink-faint);
    }

    input[type="text"]:focus, textarea:focus {
      border-color: var(--ink);
    }

    input[type="text"]:disabled, textarea:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    textarea {
      resize: vertical;
      min-height: 68px;
    }

    .checks {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .check {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      color: var(--ink);
      font-size: 12px;
    }

    .check input[type="checkbox"] {
      margin-top: 3px;
      accent-color: var(--ink);
      flex-shrink: 0;
    }

    .check.disabled {
      color: var(--ink-faint);
      cursor: not-allowed;
    }

    .list {
      flex: 1;
      overflow-y: auto;
      border-top: 1px solid var(--rule);
      max-height: 210px;
    }

    .item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 9px 2px;
      border-bottom: 1px solid var(--rule);
      cursor: pointer;
      transition: background 100ms ease;
    }

    .item:hover {
      background: var(--paper-sunk);
    }

    .item input[type="checkbox"] {
      margin-top: 3px;
      accent-color: var(--ink);
      flex-shrink: 0;
    }

    .item-body {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .item-title {
      color: var(--ink);
      word-break: break-word;
    }

    .item-meta {
      color: var(--ink-soft);
      font-size: 11px;
    }

    .spacer { flex: 1; }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      justify-content: flex-end;
      padding-top: 8px;
      border-top: 1px solid var(--rule);
    }

    .actions-left {
      margin-right: auto;
    }

    button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: transparent;
      color: var(--ink);
      border: 1px solid var(--rule);
      border-radius: var(--radius-md);
      height: 28px;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      transition: background 100ms ease, border-color 100ms ease, opacity 100ms ease;
    }

    button:hover:not(:disabled) {
      background: var(--paper-sunk);
      border-color: var(--rule-strong);
    }

    button.ghost {
      border-color: transparent;
      padding: 0 6px;
      color: var(--ink);
    }

    button.ghost:hover:not(:disabled) {
      background: var(--paper-sunk);
      border-color: transparent;
    }

    button.primary {
      background: var(--ink);
      color: var(--paper);
      border-color: var(--ink);
      padding: 0 12px;
    }

    button.primary:hover:not(:disabled) {
      opacity: 0.88;
      background: var(--ink);
      border-color: var(--ink);
    }

    button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .kbd {
      font-size: 11px;
      opacity: 0.65;
      font-weight: 400;
    }
  </style>
  <script>
    window.__DATA__ = ${safeJson(options.initialData)};
    function closeWithResult(result) {
      const payload = { method: "close_and_send", params: [JSON.stringify(result)] };
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.live) {
        window.webkit.messageHandlers.live.postMessage(payload);
      } else if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(payload);
      }
    }
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeWithResult({ action: "cancel" });
      }
    });
  </script>
</head>
<body>
  ${options.body}
  <script>
    ${options.script}
  </script>
</body>
</html>`;
}
