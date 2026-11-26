import type { PartialBlock } from "@blocknote/core";

type StyledText = {
  type: "text";
  text: string;
  styles: Record<string, unknown>;
};

/**
 * A paragraph written in the notes editor can hold several visual lines joined
 * by "\n" (BlockNote folds a hard break into the text run). The lyrics editor
 * counts per block, so each visual line becomes its own paragraph, carrying
 * the styles of the run it came from.
 *
 * The first fragment keeps the original block's id and later ones are left
 * without one for BlockNote to fill in, so a document with no soft breaks
 * passes through untouched.
 */
export const splitSoftBreaks = (blocks: PartialBlock[]): PartialBlock[] =>
  blocks.flatMap((block): PartialBlock[] => {
    if (block.type !== "paragraph" || !Array.isArray(block.content)) {
      return [block];
    }

    const runs = block.content as StyledText[];
    if (
      !runs.every((run) => run.type === "text") ||
      !runs.some((run) => run.text.includes("\n"))
    ) {
      return [block];
    }

    const lines: StyledText[][] = [[]];
    for (const run of runs) {
      run.text.split("\n").forEach((segment, i) => {
        if (i > 0) {
          lines.push([]);
        }
        if (segment) {
          lines[lines.length - 1]!.push({ ...run, text: segment });
        }
      });
    }

    return lines.map((content, i) => ({
      ...block,
      id: i === 0 ? block.id : undefined,
      content,
    }));
  });
