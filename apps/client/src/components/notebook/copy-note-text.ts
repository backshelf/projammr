import { getNoteTextClient } from "@/lib/notes-client";

/**
 * Writes a note's plain text to the clipboard.
 *
 * The server owns the walk from a BlockNote document to plain text
 * (`GET /notes/:id/text`); this only fetches that text and hands it to the
 * Clipboard API. It uses `ClipboardItem`'s promise-based item form so the
 * write stays tied to the click that triggered it: Safari revokes a page's
 * clipboard-write permission the moment an `await` breaks the user-gesture
 * call stack ahead of `navigator.clipboard.writeText`, so the fetch must be
 * handed to the clipboard as a pending `Promise<Blob>` rather than awaited
 * first. Where `ClipboardItem` isn't available, this falls back to awaiting
 * the text and writing it directly.
 */
export async function copyNoteText(noteId: number) {
  const text = getNoteTextClient(noteId).then((r) => {
    if (r.error) throw new Error("Couldn't load the note's text");
    return new Blob([r.data?.text ?? ""], { type: "text/plain" });
  });

  if ("ClipboardItem" in window) {
    await navigator.clipboard.write([
      new ClipboardItem({ "text/plain": text }),
    ]);
  } else {
    await navigator.clipboard.writeText(await (await text).text());
  }
}
