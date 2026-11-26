/**
 * The plain text of a BlockNote document. Notes are encrypted at rest, so the
 * server is the only place that can read one — the note list's titles and
 * previews and the plain-text export are all computed here, from one reading of
 * what "the text of a block" means.
 */

type Inline =
  { type: "text"; text: string } | { type: "link"; content: unknown };

/** The fields of a stored block the server reads; the editor owns the rest. */
export type Block = {
  id?: string;
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: Block[];
};

/** A block's inline content as one string, reading through links. */
export const inlineText = (content: unknown): string =>
  Array.isArray(content)
    ? (content as Inline[])
        .map((run) =>
          run.type === "text"
            ? run.text
            : run.type === "link"
              ? inlineText(run.content)
              : ""
        )
        .join("")
    : "";

/**
 * Every block's text in document order, parent before children. Blocks with no
 * inline content — a divider, a table — contribute an empty line rather than
 * disappearing, so a caller that wants only the written lines filters them out
 * and one that renders the document keeps its shape.
 */
export function blockLines(doc: unknown): string[] {
  const out: string[] = [];
  const walk = (blocks: Block[]) => {
    for (const block of blocks) {
      out.push(inlineText(block.content).trim());
      if (block.children?.length) walk(block.children);
    }
  };
  if (Array.isArray(doc)) walk(doc as Block[]);
  return out;
}

const SUMMARY_LIMIT = 200;

/**
 * A note's first two written lines: the first becomes its title, the second its
 * list preview. Blank blocks are skipped, so a document that opens with an
 * empty paragraph is still titled by the first thing typed into it. An empty
 * document has an empty title, which is what the client renders as "New note".
 */
export function noteSummaryText(doc: unknown): {
  title: string;
  preview: string;
} {
  const [title = "", preview = ""] = blockLines(doc).filter(Boolean);
  return {
    title: title.slice(0, SUMMARY_LIMIT),
    preview: preview.slice(0, SUMMARY_LIMIT),
  };
}
