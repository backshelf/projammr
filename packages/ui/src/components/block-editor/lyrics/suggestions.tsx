"use client";

import { filterSuggestionItems } from "@blocknote/core/extensions";
import {
  SuggestionMenuController,
  type SuggestionMenuProps,
} from "@blocknote/react";
import { MENU_LABEL, OVERLAY_SURFACE } from "@workspace/ui/lib/overlay";
import { cn } from "@workspace/ui/lib/utils";
import { use, useId, useMemo } from "react";
import {
  LyricsContext,
  type LyricsDictionary,
  type RhymeEntry,
} from "./context";
import type { LyricsEditor } from "./schema";
import { lyricsSlashMenuItems } from "./slash-menu";

/** A word the dictionary offers, ready to drop in at the cursor. `badge` is
 * the syllable count on a rhyme; `subtext` is the sense on a synonym. */
export type LyricsSuggestion = {
  title: string;
  group: string;
  badge?: string;
  subtext?: string;
  onItemClick: () => void;
};

/**
 * Rhymes for the typed word, perfect ones ahead of near ones — the menu keeps
 * the order it is handed and starts a new group each time `group` changes.
 */
export const rhymeItems = async (
  editor: LyricsEditor,
  dictionary: LyricsDictionary,
  query: string,
  signal: AbortSignal
): Promise<LyricsSuggestion[]> => {
  const { perfect, near } = await dictionary.rhymes(query, signal);

  const toItem =
    (group: string) =>
    (entry: RhymeEntry): LyricsSuggestion => ({
      title: entry.word,
      badge: String(entry.syllables),
      group,
      onItemClick: () => editor.insertInlineContent(entry.word),
    });

  return [...perfect.map(toItem("Perfect")), ...near.map(toItem("Near"))];
};

/** Synonyms grouped by part of speech, each row carrying the sense it came
 * from so two spellings of one idea can be told apart. */
export const synonymItems = async (
  editor: LyricsEditor,
  dictionary: LyricsDictionary,
  query: string,
  signal: AbortSignal
): Promise<LyricsSuggestion[]> => {
  const senses = await dictionary.synonyms(query, signal);

  return senses.flatMap((sense) =>
    sense.words.map((word) => ({
      title: word,
      group: sense.pos,
      subtext: sense.definition,
      onItemClick: () => editor.insertInlineContent(word),
    }))
  );
};

/**
 * Turn a signal-taking loader into the `(query) => Promise<items>` the menu
 * asks for, aborting the request the previous keystroke started — the menu
 * already discards stale results, so the abort is there to save the round
 * trip rather than to order them.
 *
 * A rejection is answered with an empty list: BlockNote calls `getItems`
 * without a catch, so letting one through would surface as an unhandled
 * rejection, and an empty list is already the menu's "nothing found" state.
 */
export const abortable = <T,>(
  load: (query: string, signal: AbortSignal) => Promise<T[]>
): ((query: string) => Promise<T[]>) => {
  let inFlight: AbortController | null = null;

  return async (query) => {
    inFlight?.abort();
    inFlight = new AbortController();

    try {
      return await load(query, inFlight.signal);
    } catch {
      return [];
    }
  };
};

type MenuRow = { item: LyricsSuggestion; index: number };

/** Consecutive runs of one group, keeping each row's index in the flat list —
 * the index is what the keyboard selection and `aria-activedescendant` are
 * expressed in. */
const groupRows = (items: LyricsSuggestion[]): [string, MenuRow[]][] =>
  items.reduce<[string, MenuRow[]][]>((groups, item, index) => {
    const last = groups.at(-1);
    if (last && last[0] === item.group) {
      last[1].push({ item, index });
    } else {
      groups.push([item.group, [{ item, index }]]);
    }
    return groups;
  }, []);

/**
 * The rhyme and synonym popup. Selection lives in the editor: BlockNote's
 * wrapper owns the arrow keys and points the caret's `aria-activedescendant`
 * at `bn-suggestion-menu-item-<index>`, so the rows carry those ids and the
 * list carries `bn-suggestion-menu`, and nothing here takes focus.
 */
export function LyricsSuggestionMenu({
  items,
  loadingState,
  selectedIndex,
  onItemClick,
  label,
}: SuggestionMenuProps<LyricsSuggestion> & { label: string }) {
  const groupId = useId();
  const groups = groupRows(items);
  const loading = loadingState !== "loaded";

  return (
    <div
      className={cn(
        OVERLAY_SURFACE,
        "max-h-72 w-max max-w-72 min-w-44 overflow-y-auto p-1 font-mono"
      )}
    >
      <div
        id="bn-suggestion-menu"
        role="listbox"
        aria-label={label}
        aria-busy={loading}
      >
        {groups.map(([group, rows], groupIndex) => (
          <div
            // A group run starts at a distinct menu row, whose index is its id.
            key={rows[0]!.index}
            role="group"
            aria-labelledby={`${groupId}-${groupIndex}`}
          >
            <div
              id={`${groupId}-${groupIndex}`}
              className={cn(MENU_LABEL, "px-2 pt-2 pb-1")}
            >
              {group}
            </div>
            {rows.map(({ item, index }) => (
              <div
                key={`${item.title}-${index}`}
                id={`bn-suggestion-menu-item-${index}`}
                role="option"
                aria-selected={index === selectedIndex}
                className={cn(
                  "flex min-h-7 cursor-default items-center gap-3 rounded-md px-2 py-1",
                  index === selectedIndex &&
                    "bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
                )}
                onClick={() => onItemClick?.(item)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">
                    {item.title}
                  </span>
                  {item.subtext && (
                    <span className="block truncate text-micro text-ink-soft">
                      {item.subtext}
                    </span>
                  )}
                </span>
                {item.badge && (
                  <span className="text-micro text-ink-soft tabular-nums">
                    {item.badge}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      {items.length === 0 && (
        <p role="status" className="px-2 py-1.5 text-micro text-ink-soft">
          {loading ? "Looking up" : "Nothing found"}
        </p>
      )}
    </div>
  );
}

const RhymeMenu = (props: SuggestionMenuProps<LyricsSuggestion>) => (
  <LyricsSuggestionMenu {...props} label="Rhymes" />
);

const SynonymMenu = (props: SuggestionMenuProps<LyricsSuggestion>) => (
  <LyricsSuggestionMenu {...props} label="Synonyms" />
);

/**
 * Every menu the lyrics editor opens. The slash menu is mounted here rather
 * than left to the frame so that it offers the lyrics schema's items; the
 * prefix menus claim their trigger characters only while a provider supplies
 * a dictionary, so without one every character types as itself.
 */
export function LyricsSuggestionMenus({ editor }: { editor: LyricsEditor }) {
  const lyrics = use(LyricsContext);
  const dictionary = lyrics?.dictionary;
  const prefixes = lyrics?.prefixes;

  const slashItems = useMemo(
    () => async (query: string) =>
      filterSuggestionItems(lyricsSlashMenuItems(editor), query),
    [editor]
  );

  const rhymes = useMemo(
    () =>
      dictionary &&
      abortable((query: string, signal: AbortSignal) =>
        rhymeItems(editor, dictionary, query, signal)
      ),
    [editor, dictionary]
  );

  const synonyms = useMemo(
    () =>
      dictionary &&
      abortable((query: string, signal: AbortSignal) =>
        synonymItems(editor, dictionary, query, signal)
      ),
    [editor, dictionary]
  );

  return (
    <>
      <SuggestionMenuController triggerCharacter="/" getItems={slashItems} />
      {rhymes && prefixes && prefixes.rhyme !== null && (
        <SuggestionMenuController
          triggerCharacter={prefixes.rhyme}
          getItems={rhymes}
          minQueryLength={1}
          suggestionMenuComponent={RhymeMenu}
        />
      )}
      {synonyms && prefixes && prefixes.synonym !== null && (
        <SuggestionMenuController
          triggerCharacter={prefixes.synonym}
          getItems={synonyms}
          minQueryLength={1}
          suggestionMenuComponent={SynonymMenu}
        />
      )}
    </>
  );
}
