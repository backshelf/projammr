import type { Combo, KeyEventLike } from "./parse";

export type { Combo, KeyEventLike };

/** A command's keys: what the keymap runs, and what a bar or a help sheet lists. */
export type Binding<Id extends string = string> = {
  /** The command the keys run; what `onRun` is called with and overrides key on. */
  id: Id;
  /** Every combo that runs the command, first the one a hint shows. */
  keys: readonly Combo[];
  /** `"global"` always answers; any other scope only while it is pushed. */
  scope: string;
  /** Scopes beyond `scope` in which the binding also answers: it answers at
   *  the deepest of them, so a scope pushed above a modal push lets the keys
   *  through the modal's silence. */
  alsoIn?: readonly string[];
  /** Checked at each press: while false the binding is as if unbound. */
  when?: () => boolean;
  label: string;
  /** A heading to list the command under, in help and settings. */
  group?: string;
  /** Takes a count typed in front of it (`5j`); others ignore one. */
  countable?: boolean;
  /** A digit binding that stands aside while the digit builds a count, so
   *  `5j` on a list moves five rows without also running the `5`. */
  yieldsToCount?: boolean;
  /** Fires even while a text field has focus. Rare: Escape, `mod+Enter`. */
  allowInInput?: boolean;
};

/** A command id to the combos that replace its declared keys; `[]` unbinds it. */
export type KeymapOverrides = Readonly<Record<string, readonly Combo[]>>;

/** What a keypress hands the command it runs. */
export type KeymapRun = {
  /** The count typed in front, for a countable command; 1 otherwise. */
  count: number;
  /** The combo that ran it: which of its keys, or which digit. */
  combo: Combo;
};

/** A command a key would run now, with the keys that would run it. */
export type KeymapCandidate<Id extends string = string> = {
  id: Id;
  keys: Combo[];
  label: string;
};

/** Two or more commands answering the same combo in the same scope. */
export type KeymapConflict<Id extends string = string> = {
  scope: string;
  combo: Combo;
  ids: Id[];
};

export type KeymapState<Id extends string = string> = {
  /** The scope stack, outermost first; `"global"` is always the floor. */
  scope: string[];
  /** The presses of a chord waiting for its second key. */
  pending: Combo[];
  /** The count being typed, or null. */
  count: number | null;
  /**
   * With a chord pending, the commands that could complete it; otherwise every
   * command a press would run now, only the countable ones while a count is
   * being typed. One command per combo: the one a press would reach.
   */
  candidates: KeymapCandidate<Id>[];
  conflicts: KeymapConflict<Id>[];
};

/** A keydown as the keymap reads it; a DOM `KeyboardEvent` is one. */
export type KeymapEvent = KeyEventLike & {
  repeat?: boolean;
  defaultPrevented?: boolean;
  target?: EventTarget | null;
  preventDefault?: () => void;
};

export type KeymapOptions<Id extends string = string> = {
  bindings: readonly Binding<Id>[];
  overrides?: KeymapOverrides;
  onRun: (id: Id, run: KeymapRun) => void;
  /** How long a chord or a count waits for its next key. */
  chordWindowMs?: number;
  /** Let a held key's auto-repeat run commands again. Off by default. */
  repeat?: boolean;
};

export type ScopeOptions = {
  /** Silence every scope beneath this one, the global scope included. */
  modal?: boolean;
};

export type Keymap<Id extends string = string> = {
  /** Feeds one keydown; the caller owns the listener. */
  dispatch: (event: KeymapEvent) => void;
  subscribe: (listener: () => void) => () => void;
  /** The same object until something in it changes. */
  state: () => KeymapState<Id>;
  /** Pushes a scope; the returned function pops this push and no other. */
  pushScope: (name: string, options?: ScopeOptions) => () => void;
  /** Pops the innermost push of a scope. */
  popScope: (name: string) => void;
  setOverrides: (overrides: KeymapOverrides) => void;
  setBindings: (bindings: readonly Binding<Id>[]) => void;
  /** The bindings with their effective keys: canonical, overrides applied. */
  bindings: () => readonly Binding<Id>[];
  /** Drops a pending chord or count without running anything. */
  reset: () => void;
};
