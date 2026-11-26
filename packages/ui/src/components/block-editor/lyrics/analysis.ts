import { createExtension } from "@blocknote/core";
import type { Node } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { LyricsDictionary, WordAnalysis } from "./context";
import { WORD, words } from "./text";

export type LineFacts = {
  /** Position of the block's content node in the document. */
  pos: number;
  size: number;
  /** The block's own id, stable across the edits made inside it. */
  id: string | null;
  kind: "line" | "section";
  text: string;
  /** null while any word is unknown to the cache. */
  syllables: number | null;
  estimated: boolean;
  /** The last word's key, null when it is unknown or only estimated. */
  rhymeKey: string | null;
  /** The last word's slant keys, empty when it is unknown or only estimated. */
  slantKeys: string[];
  lastWordRange: { from: number; to: number } | null;
  unknown: string[];
};

export type SectionStats = { lines: number; average: number | null };

export type Scheme = Map<
  number /* line index */,
  { letter: string; index: number; slant: boolean }
>;

/**
 * The document range of the block's final word, or null when the block holds
 * an inline node that isn't text — inline offsets only line up with the
 * concatenated text while every child is a text node.
 */
const lastWordRange = (content: Node, start: number) => {
  let text = "";
  let plain = true;
  content.forEach((child) => {
    if (!child.isText) {
      plain = false;
    }
    text += child.text ?? "";
  });
  if (!plain) {
    return null;
  }

  const matches = [...text.matchAll(WORD)];
  const last = matches[matches.length - 1];
  if (!last) {
    return null;
  }

  const from = start + 1 + last.index;
  return { from, to: from + last[0].length };
};

/**
 * One entry per lyric line, in document order. A "line" is a block: the lyrics
 * paragraph splits on Shift+Enter rather than inserting a soft break, so every
 * visual line is its own `blockContainer`.
 */
export const readLines = (
  doc: Node,
  cache: ReadonlyMap<string, WordAnalysis>
): LineFacts[] => {
  const lines: LineFacts[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "blockContainer") {
      return true;
    }
    const content = node.firstChild;
    if (!content) {
      return false;
    }
    const kind =
      content.type.name === "section"
        ? "section"
        : content.type.name === "paragraph"
          ? "line"
          : null;
    if (!kind) {
      return false;
    }

    const text = content.textContent;
    const ws = words(text);
    const facts = ws.map((w) => cache.get(w.toLowerCase()));
    const unknown = ws.filter((w) => !cache.has(w.toLowerCase()));
    const known = facts.every((f): f is WordAnalysis => !!f);
    const last = facts.length ? facts[facts.length - 1] : undefined;

    lines.push({
      pos: pos + 1,
      size: content.nodeSize,
      id: typeof node.attrs.id === "string" ? node.attrs.id : null,
      kind,
      text,
      syllables:
        known && ws.length ? facts.reduce((n, f) => n + f!.syllables, 0) : null,
      estimated: known && facts.some((f) => f!.estimated),
      rhymeKey: last && !last.estimated ? last.rhymeKey : null,
      slantKeys: last && !last.estimated ? last.slantKeys : [],
      lastWordRange: lastWordRange(content, pos + 1),
      unknown,
    });

    return false;
  });

  return lines;
};

export type HeldCount = { syllables: number; estimated: boolean };

/**
 * The count a line shows while its words are still being looked up: the last
 * one it resolved to.
 *
 * A word typed a character at a time is unknown to the cache at every
 * spelling it passes through, so without this a line loses its figure on
 * every keystroke and gets it back only once the debounced lookup lands. A
 * line with nothing pending keeps whatever it computed — emptying a line
 * clears its count rather than freezing the old one.
 */
export const holdCounts = (
  lines: LineFacts[],
  held: Map<string, HeldCount>
): LineFacts[] =>
  lines.map((line) => {
    if (!line.id) {
      return line;
    }
    if (line.syllables !== null) {
      held.set(line.id, {
        syllables: line.syllables,
        estimated: line.estimated,
      });
      return line;
    }
    if (!line.unknown.length) {
      held.delete(line.id);
      return line;
    }
    const last = held.get(line.id);
    return last ? { ...line, ...last } : line;
  });

/**
 * Lines between one section block and the next form a group; a document with
 * no section block is one group.
 */
export const groups = (lines: LineFacts[]): number[][] => {
  const result: number[][] = [[]];
  lines.forEach((line, i) => {
    if (line.kind === "section") {
      result.push([]);
    } else {
      result[result.length - 1]!.push(i);
    }
  });
  return result.filter((g) => g.length);
};

export const sectionStats = (
  lines: LineFacts[],
  group: number[]
): SectionStats => {
  const counted = group
    .map((i) => lines[i]!)
    .filter((l) => l.text.trim() && l.syllables !== null);
  const nonEmpty = group.filter((i) => lines[i]!.text.trim()).length;

  return {
    lines: nonEmpty,
    average: counted.length
      ? Math.round(
          (counted.reduce((n, l) => n + l.syllables!, 0) / counted.length) * 10
        ) / 10
      : null,
  };
};

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

type Cluster = { members: number[]; slant: Set<number> };

/**
 * Rhyme scheme per group: lines whose last words rhyme get one letter,
 * assigned in order of first appearance. A letter used by a single line gets
 * nothing — a scheme is a relation between lines, not a property of one.
 * Letters restart in every section, the way a scheme is written by hand.
 *
 * Perfect rhymes cluster first, since a shared rhyme key is the strongest
 * relation available; a line left over then joins the earliest cluster it
 * slant-rhymes with, and whatever is still loose clusters among itself. Slant
 * members carry the cluster's letter in lowercase.
 */
export const scheme = (lines: LineFacts[], group: number[]): Scheme => {
  const clusters: Cluster[] = [];
  const clusterOf = new Map<number, Cluster>();
  const open = (members: number[], slant: boolean) => {
    const cluster = {
      members: [...members],
      slant: new Set(slant ? members : []),
    };
    clusters.push(cluster);
    for (const m of members) {
      clusterOf.set(m, cluster);
    }
  };

  const byKey = new Map<string, number[]>();
  for (const i of group) {
    const k = lines[i]!.rhymeKey;
    if (k) {
      byKey.set(k, [...(byKey.get(k) ?? []), i]);
    }
  }
  for (const i of group) {
    const k = lines[i]!.rhymeKey;
    if (!k || clusterOf.has(i)) {
      continue;
    }
    const members = byKey.get(k)!;
    if (members.length > 1) {
      open(members, false);
    }
  }

  const slantMatch = (a: number, b: number) =>
    lines[a]!.slantKeys.some((k) => lines[b]!.slantKeys.includes(k));
  const loose = group.filter(
    (i) => !clusterOf.has(i) && lines[i]!.slantKeys.length
  );

  for (const i of loose) {
    const host = clusters.find((c) => c.members.some((m) => slantMatch(i, m)));
    if (host) {
      host.members.push(i);
      host.slant.add(i);
      clusterOf.set(i, host);
    }
  }

  for (const i of loose) {
    if (clusterOf.has(i)) {
      continue;
    }
    const members = loose.filter((j) => !clusterOf.has(j) && slantMatch(i, j));
    if (members.length > 1) {
      open(members, true);
    }
  }

  const out: Scheme = new Map();
  clusters
    .sort((a, b) => Math.min(...a.members) - Math.min(...b.members))
    .forEach((cluster, index) => {
      const letter =
        LETTERS[index % 26]! +
        (index >= 26 ? String(Math.floor(index / 26)) : "");
      for (const m of cluster.members) {
        const slant = cluster.slant.has(m);
        out.set(m, {
          letter: slant ? letter.toLowerCase() : letter,
          index,
          slant,
        });
      }
    });

  return out;
};

/**
 * The syllable count, rhyme letter and section stats, carried as attributes
 * for the stylesheet to paint. `--rhyme-index` picks the group's hue.
 */
export const decorate = (doc: Node, lines: LineFacts[]): DecorationSet => {
  const decos: Decoration[] = [];

  for (const group of groups(lines)) {
    const sch = scheme(lines, group);

    for (const i of group) {
      const line = lines[i]!;
      if (!line.text.trim()) {
        continue;
      }

      const attrs: Record<string, string> = {};
      if (line.syllables !== null) {
        attrs["data-syllables"] = String(line.syllables);
      }
      if (line.estimated) {
        attrs["data-syllables-estimated"] = "true";
      }

      const rhyme = sch.get(i);
      if (rhyme) {
        attrs["data-rhyme"] = rhyme.letter;
        attrs.style = `--rhyme-index:${rhyme.index}`;
        if (line.lastWordRange) {
          decos.push(
            Decoration.inline(line.lastWordRange.from, line.lastWordRange.to, {
              class: rhyme.slant
                ? "lyric-rhyme lyric-rhyme-slant"
                : "lyric-rhyme",
              style: `--rhyme-index:${rhyme.index}`,
            })
          );
        }
      }

      if (Object.keys(attrs).length) {
        decos.push(Decoration.node(line.pos, line.pos + line.size, attrs));
      }
    }

    const head = lines[group[0]! - 1];
    if (head?.kind === "section") {
      const stats = sectionStats(lines, group);
      decos.push(
        Decoration.node(head.pos, head.pos + head.size, {
          "data-section-lines": String(stats.lines),
          ...(stats.average !== null
            ? { "data-section-average": String(stats.average) }
            : {}),
        })
      );
    }
  }

  return DecorationSet.create(doc, decos);
};

/** What one analysis pass leaves behind: what to paint, and what to look up. */
export type Analysis = { set: DecorationSet; unknown: string[] };

export const analysisKey = new PluginKey<Analysis>("lyrics-analysis");

/**
 * One pass per change. `decorate` clusters the rhymes in every section, so
 * running it a second time just to reach the unknown words would double the
 * most expensive part of a keystroke — the words the pass already collected
 * ride along in plugin state instead. The fetch is debounced, and its result
 * is applied with a metadata-only transaction so nothing in React re-renders
 * for it.
 */
export const createAnalysisPlugin = (dictionary: LyricsDictionary | null) => {
  const cache = new Map<string, WordAnalysis>();
  const held = new Map<string, HeldCount>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const compute = (doc: Node): Analysis => {
    const lines = holdCounts(readLines(doc, cache), held);
    return {
      set: decorate(doc, lines),
      unknown: [...new Set(lines.flatMap((l) => l.unknown))],
    };
  };

  return new Plugin<Analysis>({
    key: analysisKey,
    state: {
      init: (_, state) => compute(state.doc),
      apply: (tr, prev, _old, state) =>
        tr.docChanged || tr.getMeta(analysisKey)
          ? compute(state.doc)
          : { set: prev.set.map(tr.mapping, tr.doc), unknown: prev.unknown },
    },
    props: {
      decorations: (state) => analysisKey.getState(state)?.set,
    },
    view: (view) => {
      const request = () => {
        if (!dictionary) {
          return;
        }
        const unknown = analysisKey.getState(view.state)?.unknown;
        if (!unknown?.length) {
          return;
        }
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const entries = await dictionary.analyze(unknown);
          for (const entry of entries) {
            cache.set(entry.word.toLowerCase(), entry);
          }
          if (!view.isDestroyed) {
            view.dispatch(view.state.tr.setMeta(analysisKey, "refresh"));
          }
        }, 300);
      };

      request();

      return {
        update: (v, prevState) => {
          if (v.state.doc !== prevState.doc) {
            request();
          }
        },
        destroy: () => clearTimeout(timer),
      };
    },
  });
};

/**
 * The plugin as a BlockNote extension. The field is `prosemirrorPlugins` — an
 * unknown key is dropped without complaint, so a misspelling here shows up
 * only as a gutter that never paints.
 */
export const lyricsAnalysis = (dictionary: LyricsDictionary | null) =>
  createExtension({
    key: "lyrics-analysis",
    prosemirrorPlugins: [createAnalysisPlugin(dictionary)],
  });
