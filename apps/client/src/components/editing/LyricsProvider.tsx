"use client";

import { useMemo, type PropsWithChildren } from "react";
import { LyricsContext } from "@workspace/ui/components/block-editor/lyrics/context";
import { browserLyricsDictionary } from "@/lib/lyrics-dictionary";
import { useSetting } from "@/lib/settings/provider";

/**
 * Supplies the lyrics editor's dictionary and prefix characters to any
 * `Description`/`TrackForm` field mounted underneath with `variant="lyrics"`.
 * The prefixes are the caller's effective `editor.rhymePrefix` and
 * `editor.synonymPrefix`, so a change to either reaches an open editor. Either
 * prefix is null when its suggestion type is off (`editor.rhymeSuggestions` /
 * `editor.synonymSuggestions`), so that menu never opens.
 */
export function LyricsProvider({ children }: PropsWithChildren) {
  const rhymePrefix = useSetting("editor.rhymePrefix");
  const synonymPrefix = useSetting("editor.synonymPrefix");
  const rhymeSuggestions = useSetting("editor.rhymeSuggestions");
  const synonymSuggestions = useSetting("editor.synonymSuggestions");
  const rhyme = rhymeSuggestions ? rhymePrefix : null;
  const synonym = synonymSuggestions ? synonymPrefix : null;
  const value = useMemo(
    () => ({
      dictionary: browserLyricsDictionary,
      prefixes: { rhyme, synonym },
    }),
    [rhyme, synonym]
  );

  return <LyricsContext value={value}>{children}</LyricsContext>;
}
