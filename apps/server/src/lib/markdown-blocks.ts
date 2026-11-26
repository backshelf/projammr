/**
 * Markdown to and from the two BlockNote schemas the app stores: an entity
 * note's full default schema ("document") and a notebook lyric, one block per
 * line with a `section` block for `[Chorus]`-style headers ("lyrics").
 *
 * The flavour is CommonMark plus GFM task lists and strikethrough, cut down to
 * what the blocks can hold. Anything the markdown cannot express travels as a
 * `<!-- keep:<id> -->` placeholder that puts the stored block back on write.
 * Underline, colours, alignment and the children of a non-list block do not
 * survive a read-then-write.
 */
import type { BlockDocument } from "../db/schema/base.js";
import { type Block, inlineText } from "./block-text.js";

export type ConvertMode = "document" | "lyrics";

type Style = "bold" | "italic" | "strike" | "code";
type Styles = Partial<Record<Style, true>>;
type Run = { type: "text"; text: string; styles: Styles };
type Link = { type: "link"; href: string; content: Run[] };
type Inline = Run | Link;

const STYLES: Style[] = ["bold", "italic", "strike", "code"];

const TOKEN: Record<Style, string> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  code: "`",
};

const MARKS: [string, Style][] = [
  ["**", "bold"],
  ["~~", "strike"],
  ["*", "italic"],
  ["_", "italic"],
  ["`", "code"],
];

const isRun = (inline: Inline): inline is Run => inline.type === "text";

const sameStyles = (a: Styles, b: Styles) =>
  STYLES.every((style) => a[style] === b[style]);

/** Joins neighbouring text runs whose styles are equal and drops empty ones. */
function mergeRuns<T extends Inline>(inlines: T[]): T[] {
  const out: T[] = [];
  for (const inline of inlines) {
    if (isRun(inline) && inline.text === "") continue;
    const last = out.at(-1);
    if (
      last &&
      isRun(last) &&
      isRun(inline) &&
      sameStyles(last.styles, inline.styles)
    ) {
      out[out.length - 1] = { ...last, text: last.text + inline.text } as T;
    } else {
      out.push(inline);
    }
  }
  return out;
}

const WORD = /[\p{L}\p{N}]/u;

/**
 * Whether the `_` at `at` sits between two word characters, as in a file
 * name like `take_01_final.wav`. CommonMark never reads such an underscore
 * as emphasis, and an AI writing plain names should not get italics.
 */
const intraword = (line: string, at: number, token: string) =>
  token === "_" &&
  WORD.test(line[at - 1] ?? "") &&
  WORD.test(line[at + token.length] ?? "");

/** The first `token` at or after `from` that no backslash escapes and can act as a mark, or -1. */
function indexOfUnescaped(line: string, token: string, from: number): number {
  for (let i = from; i < line.length; i += 1) {
    if (line[i] === "\\") {
      i += 1;
      continue;
    }
    if (line.startsWith(token, i) && !intraword(line, i, token)) return i;
  }
  return -1;
}

const unescape = (text: string) => text.replace(/\\(.)/g, "$1");

/**
 * Parses one line's inline markup into styled runs. Marks toggle; an
 * unmatched opener is literal text, and so is an empty code span, so a
 * run of backticks reads as itself; a code span swallows every other mark
 * until its closing backtick; a backslash escapes the next character. Links
 * are `[text](href)` with inline marks allowed in the text, and the marks open
 * around a link apply to its text.
 */
function parseInline(line: string, initial: Styles = {}): Inline[] {
  const out: Inline[] = [];
  const open: Styles = { ...initial };
  let buf = "";
  const flush = () => {
    if (buf) out.push({ type: "text", text: buf, styles: { ...open } });
    buf = "";
  };
  for (let i = 0; i < line.length;) {
    const ch = line[i]!;
    if (ch === "\\" && i + 1 < line.length) {
      buf += line[i + 1];
      i += 2;
      continue;
    }
    if (open.code) {
      if (ch === "`") {
        flush();
        delete open.code;
      } else {
        buf += ch;
      }
      i += 1;
      continue;
    }
    if (ch === "[") {
      const close = indexOfUnescaped(line, "](", i + 1);
      const end = close >= 0 ? indexOfUnescaped(line, ")", close + 2) : -1;
      if (end >= 0) {
        flush();
        const content = parseInline(line.slice(i + 1, close), open).filter(
          isRun
        );
        out.push({
          type: "link",
          href: unescape(line.slice(close + 2, end)),
          content: mergeRuns(content),
        });
        i = end + 1;
        continue;
      }
    }
    const mark = MARKS.find(([token]) => line.startsWith(token, i));
    if (mark && !intraword(line, i, mark[0])) {
      const [token, style] = mark;
      const closes = open[style] === true;
      const closer = indexOfUnescaped(line, token, i + token.length);
      const empty = style === "code" && closer === i + token.length;
      const opensLater = !closes && closer >= 0 && !empty;
      if (closes || opensLater) {
        flush();
        if (closes) delete open[style];
        else open[style] = true;
        i += token.length;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return mergeRuns(out);
}

type Line =
  | { kind: "blank" }
  | { kind: "heading"; level: number; text: string }
  | {
      kind: "list";
      variant: "bullet" | "numbered" | "check";
      checked?: boolean;
      depth: number;
      text: string;
    }
  | { kind: "quote"; text: string }
  | { kind: "section"; label: string }
  | { kind: "fence"; fence: string; language: string }
  | { kind: "rule" }
  | { kind: "keep"; id: string }
  | { kind: "text"; text: string };

const LIST =
  /^(\s*)(?:([-+*])|(\d+)[.)])(?:\s+(?:\[([ xX])\](?:\s+|$))?(.*))?$/;

/** Classifies one source line. `mode` decides whether `[Label]` and fences mean anything. */
function classifyLine(raw: string, mode: ConvertMode): Line {
  const line = raw.replace(/\s+$/, "");
  if (line.trim() === "") return { kind: "blank" };
  const keep = /^<!--\s*keep:([^\s]+)\s*-->$/.exec(line);
  if (keep) return { kind: "keep", id: keep[1]! };
  const heading = /^(#{1,6})(?:\s+(.*))?$/.exec(line);
  if (heading) {
    return {
      kind: "heading",
      level: heading[1]!.length,
      text: heading[2] ?? "",
    };
  }
  if (mode === "lyrics") {
    const section = /^\[((?:\\.|[^\]\\])+)\]$/.exec(line);
    if (section) return { kind: "section", label: section[1]! };
  } else {
    const fence = /^(`{3,})\s*([^\s`]*)$/.exec(line);
    if (fence) {
      return { kind: "fence", fence: fence[1]!, language: fence[2]! };
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) return { kind: "rule" };
  }
  const list = LIST.exec(line);
  if (list) {
    const depth = Math.floor(list[1]!.length / 2);
    const text = list[5] ?? "";
    if (list[4] !== undefined) {
      return {
        kind: "list",
        variant: "check",
        checked: /x/i.test(list[4]),
        depth,
        text,
      };
    }
    const variant = list[3] !== undefined ? "numbered" : "bullet";
    return { kind: "list", variant, depth, text };
  }
  const quote = /^>\s?(.*)$/.exec(line);
  if (quote) return { kind: "quote", text: quote[1]! };
  return { kind: "text", text: line };
}

/** A block's inline content in the converter's shape: known marks only, runs merged. */
function readInline(content: unknown): Inline[] {
  if (!Array.isArray(content)) return [];
  const out: Inline[] = [];
  for (const item of content as Record<string, unknown>[]) {
    if (item.type === "text" && typeof item.text === "string") {
      const source = (item.styles ?? {}) as Record<string, unknown>;
      const styles: Styles = {};
      for (const style of STYLES)
        if (source[style] === true) styles[style] = true;
      out.push({ type: "text", text: item.text, styles });
    } else if (item.type === "link" && typeof item.href === "string") {
      const runs = readInline(item.content).filter(isRun);
      out.push({ type: "link", href: item.href, content: runs });
    }
  }
  return mergeRuns(out);
}

/**
 * Leading and trailing whitespace does not survive a markdown line, so it is
 * dropped before emitting; a run such as `* x*` would otherwise open a line as
 * a list marker.
 */
function trimEdges(inlines: Inline[]): Inline[] {
  const out = [...inlines];
  const trim = (index: number, fn: (text: string) => string) => {
    const inline = out[index];
    if (inline && isRun(inline))
      out[index] = { ...inline, text: fn(inline.text) };
  };
  trim(0, (text) => text.trimStart());
  trim(out.length - 1, (text) => text.trimEnd());
  return mergeRuns(out);
}

const escapeText = (text: string, code: boolean) =>
  code ? text.replace(/[\\`]/g, "\\$&") : text.replace(/[\\*_`~[\]]/g, "\\$&");

const escapeHref = (href: string) => href.replace(/[\\)]/g, "\\$&");

/** The styles every run of a link shares, less `code`, which must sit inside the brackets. */
function sharedStyles(runs: Run[]): Styles {
  const shared: Styles = {};
  for (const style of STYLES) {
    if (
      style !== "code" &&
      runs.length &&
      runs.every((run) => run.styles[style])
    ) {
      shared[style] = true;
    }
  }
  return shared;
}

/**
 * Emits runs as toggling marks relative to `base`, the marks already open
 * around them. A code span closes before any other mark toggles and reopens
 * after, because nothing inside a code span is read as a mark.
 */
function emitInline(inlines: Inline[], base: Styles = {}): string {
  let out = "";
  const open: Styles = { ...base };
  const moveTo = (want: Styles) => {
    const toggles = STYLES.filter(
      (style) => style !== "code" && !open[style] !== !want[style]
    );
    if (open.code && (!want.code || toggles.length)) {
      out += TOKEN.code;
      delete open.code;
    }
    for (const style of toggles) {
      out += TOKEN[style];
      if (open[style]) delete open[style];
      else open[style] = true;
    }
    if (want.code && !open.code) {
      out += TOKEN.code;
      open.code = true;
    }
  };
  for (const inline of inlines) {
    if (isRun(inline)) {
      moveTo(inline.styles);
      out += escapeText(inline.text, inline.styles.code === true);
    } else {
      const shared = sharedStyles(inline.content);
      moveTo(shared);
      out += `[${emitInline(inline.content, shared)}](${escapeHref(inline.href)})`;
    }
  }
  moveTo(base);
  return out;
}

/** Escapes what would make a paragraph line read back as another block. */
function escapeLineStart(line: string): string {
  const numbered = /^\d+(?=[.)])/.exec(line);
  if (numbered) return `${numbered[0]}\\${line.slice(numbered[0].length)}`;
  return /^[#>+\-<]/.test(line) ? `\\${line}` : line;
}

type Emitted = { text: string; list: boolean };

type BlockFormat = {
  modes: ConvertMode[];
  list?: boolean;
  toMarkdown: (block: Block, mode: ConvertMode) => string;
};

/** A block's inline content on one line; line breaks inside it become spaces. */
const oneLine = (block: Block) =>
  emitInline(
    trimEdges(
      readInline(block.content).map((inline) =>
        isRun(inline)
          ? { ...inline, text: inline.text.replace(/\n/g, " ") }
          : inline
      )
    )
  );

const FORMATS: Record<string, BlockFormat> = {
  paragraph: {
    modes: ["document", "lyrics"],
    toMarkdown: (block, mode) => {
      if (mode === "lyrics") return escapeLineStart(oneLine(block));
      return emitInline(trimEdges(readInline(block.content)))
        .split("\n")
        .map(escapeLineStart)
        .join("\\\n");
    },
  },
  heading: {
    modes: ["document", "lyrics"],
    toMarkdown: (block) => {
      const level = Number(block.props?.level);
      const hashes = "#".repeat(Math.min(Math.max(level || 1, 1), 6));
      return `${hashes} ${oneLine(block)}`;
    },
  },
  bulletListItem: {
    modes: ["document", "lyrics"],
    list: true,
    toMarkdown: (block) => `- ${oneLine(block)}`,
  },
  numberedListItem: {
    modes: ["document", "lyrics"],
    list: true,
    toMarkdown: (block) => `1. ${oneLine(block)}`,
  },
  checkListItem: {
    modes: ["document", "lyrics"],
    list: true,
    toMarkdown: (block) =>
      `- [${block.props?.checked === true ? "x" : " "}] ${oneLine(block)}`,
  },
  quote: {
    modes: ["document", "lyrics"],
    toMarkdown: (block) => `> ${oneLine(block)}`,
  },
  section: {
    modes: ["lyrics"],
    toMarkdown: (block) => `[${oneLine(block)}]`,
  },
  codeBlock: {
    modes: ["document"],
    toMarkdown: (block) => {
      const code = inlineText(block.content);
      const longest = Math.max(
        2,
        ...(code.match(/`+/g) ?? []).map((run) => run.length)
      );
      const fence = "`".repeat(longest + 1);
      const language = block.props?.language;
      const info =
        typeof language === "string" && language !== "text" ? language : "";
      return `${fence}${info}\n${code}${code ? "\n" : ""}${fence}`;
    },
  },
  divider: {
    modes: ["document"],
    toMarkdown: () => "---",
  },
};

function emitBlocks(
  blocks: Block[],
  mode: ConvertMode,
  depth: number,
  out: Emitted[]
) {
  for (const block of blocks) {
    const format = block.type ? FORMATS[block.type] : undefined;
    if (!format?.modes.includes(mode)) {
      if (block.id)
        out.push({ text: `<!-- keep:${block.id} -->`, list: false });
      continue;
    }
    const text = format.toMarkdown(block, mode);
    if (format.list) {
      out.push({ text: `${"  ".repeat(depth)}${text}`.trimEnd(), list: true });
      emitBlocks(block.children ?? [], mode, depth + 1, out);
    } else {
      if (mode === "lyrics" || text !== "") {
        out.push({ text: text.trimEnd(), list: false });
      }
      emitBlocks(block.children ?? [], mode, depth, out);
    }
  }
}

/**
 * The markdown for a stored document. Lyrics are one line per block with an
 * empty paragraph as an empty line; a document separates blocks with a blank
 * line, except between list items, and drops empty paragraphs.
 */
export function blocksToMarkdown(
  doc: BlockDocument,
  mode: ConvertMode
): string {
  const emitted: Emitted[] = [];
  emitBlocks(doc as Block[], mode, 0, emitted);
  if (mode === "lyrics") return emitted.map((line) => line.text).join("\n");
  return emitted
    .map((line, index) => {
      const previous = emitted[index - 1];
      if (!previous) return line.text;
      return `${previous.list && line.list ? "\n" : "\n\n"}${line.text}`;
    })
    .join("");
}

type NewBlock = Block & {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: Block[];
};

const newBlock = (
  type: string,
  content: unknown,
  props: Record<string, unknown> = {}
): NewBlock => ({
  id: crypto.randomUUID(),
  type,
  props,
  content,
  children: [],
});

const LIST_TYPES = {
  bullet: "bulletListItem",
  numbered: "numberedListItem",
  check: "checkListItem",
} as const;

function indexBlocks(blocks: Block[], index = new Map<string, Block>()) {
  for (const block of blocks) {
    if (block.id) index.set(block.id, block);
    indexBlocks(block.children ?? [], index);
  }
  return index;
}

/** A trailing backslash that no other backslash escapes: a hard line break. */
const endsInBreak = (text: string) =>
  (/\\+$/.exec(text)?.[0].length ?? 0) % 2 === 1;

/**
 * The stored document for a markdown body. `existing` is the document it
 * replaces; a `keep` placeholder naming one of its blocks puts that block back,
 * and one naming no block is dropped.
 */
export function markdownToBlocks(
  markdown: string,
  mode: ConvertMode,
  existing: BlockDocument = []
): BlockDocument {
  const kept = indexBlocks(existing as Block[]);
  const blocks: Block[] = [];
  const lists: NewBlock[] = [];
  let paragraph: { block: NewBlock; source: string } | null = null;
  let afterBlank = false;
  const lines = markdown.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = classifyLine(lines[i]!, mode);
    const blank = line.kind === "blank";
    if (line.kind !== "text") paragraph = null;
    if (line.kind !== "list" && !(blank && mode === "document")) {
      lists.length = 0;
    }

    switch (line.kind) {
      case "blank":
        if (mode === "lyrics" && !afterBlank) {
          blocks.push(newBlock("paragraph", []));
        }
        break;
      case "text": {
        const text = line.text.trimStart();
        if (mode === "document" && paragraph) {
          paragraph.source = endsInBreak(paragraph.source)
            ? `${paragraph.source.slice(0, -1)}\n${text}`
            : `${paragraph.source} ${text}`;
          paragraph.block.content = parseInline(paragraph.source);
        } else {
          const block = newBlock("paragraph", parseInline(text));
          blocks.push(block);
          if (mode === "document") paragraph = { block, source: text };
        }
        break;
      }
      case "heading":
        blocks.push(
          newBlock("heading", parseInline(line.text), { level: line.level })
        );
        break;
      case "quote":
        blocks.push(newBlock("quote", parseInline(line.text)));
        break;
      case "section":
        blocks.push(newBlock("section", parseInline(line.label)));
        break;
      case "rule":
        blocks.push({
          id: crypto.randomUUID(),
          type: "divider",
          props: {},
          children: [],
        });
        break;
      case "keep": {
        const block = kept.get(line.id);
        if (block) blocks.push(structuredClone(block));
        break;
      }
      case "fence": {
        const closing = new RegExp(`^${line.fence}\`*\\s*$`);
        const code: string[] = [];
        for (i += 1; i < lines.length && !closing.test(lines[i]!); i += 1) {
          code.push(lines[i]!);
        }
        const text = code.join("\n");
        blocks.push(
          newBlock(
            "codeBlock",
            text ? [{ type: "text", text, styles: {} }] : [],
            { language: line.language || "text" }
          )
        );
        break;
      }
      case "list": {
        const props = line.variant === "check" ? { checked: line.checked } : {};
        const item = newBlock(
          LIST_TYPES[line.variant],
          parseInline(line.text),
          props
        );
        const depth = Math.min(line.depth, lists.length);
        const parent = lists[depth - 1];
        if (parent) parent.children.push(item);
        else blocks.push(item);
        lists.length = depth;
        lists.push(item);
        break;
      }
    }
    afterBlank = blank;
  }
  return blocks as BlockDocument;
}
