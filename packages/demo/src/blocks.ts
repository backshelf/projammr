import type { DemoText } from "./model";

type Block = Record<string, unknown>;

const text = (value: string) => [{ type: "text", text: value, styles: {} }];

/**
 * A `DemoText` as the BlockNote document the editors store. A `# ` line is a
 * heading in a note and a section in lyrics (the lyrics editor groups lines
 * by section); an empty line is an empty paragraph.
 */
export function toBlocks(lines: DemoText, mode: "note" | "lyrics"): Block[] {
  return lines.map((line): Block => {
    if (line.startsWith("# ")) {
      const title = line.slice(2);
      return mode === "lyrics"
        ? { type: "section", content: text(title) }
        : { type: "heading", props: { level: 3 }, content: text(title) };
    }
    return line
      ? { type: "paragraph", content: text(line) }
      : { type: "paragraph" };
  });
}
