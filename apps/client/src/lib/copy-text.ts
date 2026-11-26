/**
 * Copies text to the clipboard, falling back to a hidden `<textarea>` and
 * `document.execCommand("copy")` when the Clipboard API is missing or
 * rejects. `navigator.clipboard` is undefined, or `writeText` rejects,
 * outside a secure context — plain `http://` on a LAN address is the common
 * case here, since nothing else about the page distinguishes it.
 *
 * Returns whether either path copied the text, so a caller can offer a
 * manual "select and copy" dialog once both have failed.
 */
export async function copyText(value: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the execCommand path.
    }
  }
  return legacyCopy(value);
}

function legacyCopy(value: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
