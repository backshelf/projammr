/**
 * A promise a test opens on demand, so a handler under test can be held at a
 * known point and released once the test has observed the state it stopped
 * at.
 */
export function gate(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}
