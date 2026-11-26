/**
 * The Projammr mark as portable shape data, shared between the interactive
 * `Logo` component (an `IconSvg` styled with Tailwind classes) and the
 * generated PWA icon routes (`app/icon.tsx`, `app/apple-icon.tsx`), which
 * render with Satori and cannot consume Tailwind classes or `IconSvg`.
 */
export type LogoShape =
  | {
      tag: "rect";
      attrs: { x: number; y: number; width: number; height: number };
    }
  | { tag: "path"; attrs: { d: string } };

export const LOGO: { viewBox: string; shapes: LogoShape[] } = {
  viewBox: "0 0 240 240",
  shapes: [
    {
      tag: "rect",
      attrs: { x: 32.059, y: 69.208, width: 175.882, height: 18.235 },
    },
    {
      tag: "rect",
      attrs: { x: 32.059, y: 101.643, width: 175.882, height: 19.706 },
    },
    {
      tag: "rect",
      attrs: { x: 32.059, y: 135.549, width: 175.882, height: 19.706 },
    },
    {
      tag: "path",
      attrs: { d: "M74.476,202.639l-19.706,0l0,-48.303l19.706,0l0,48.303Z" },
    },
    {
      tag: "path",
      attrs: { d: "M185.23,202.639l-19.706,0l0,-48.303l19.706,0l0,48.303Z" },
    },
    {
      tag: "rect",
      attrs: { x: 32.059, y: 35.705, width: 175.882, height: 19.304 },
    },
  ],
};

/** A React key for a shape: no two shapes in the mark share a position or path. */
export function logoShapeKey(shape: LogoShape): string {
  return shape.tag === "rect"
    ? `rect:${shape.attrs.x},${shape.attrs.y}`
    : `path:${shape.attrs.d}`;
}
