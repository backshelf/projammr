// Resolve the theme before first paint. next-themes only applies the class
// once React mounts, which in a client-only renderer is a frame or two of the
// wrong background. A plain, non-module script (rather than inline in
// index.html) so it runs synchronously before that paint while still
// satisfying a `script-src` with no inline exception.
(() => {
  const stored = localStorage.getItem("theme");
  const theme =
    stored && stored !== "system"
      ? stored
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.classList.add(theme);
})();
