import { isActivationTarget, isTypingTarget } from "./targets";
import { parseCombo, canonicalCombo, type Combo } from "./parse";
import type {
  Binding,
  Keymap,
  KeymapCandidate,
  KeymapConflict,
  KeymapEvent,
  KeymapOptions,
  KeymapOverrides,
  KeymapState,
  ScopeOptions,
} from "./types";

/** How long a chord's first key, or a count, waits for the next key. */
export const CHORD_WINDOW_MS = 1200;

/** The scope that always answers, unless a modal scope is pushed over it. */
export const GLOBAL_SCOPE = "global";

/** A bare letter, the only press a chord may open with. */
const CHORD_OPENER = /^[a-z]$/;

const DIGIT = /^[0-9]$/;

/** The keys a focused control answers to itself: activating it. */
const ACTIVATION_KEYS = new Set(["space", "Enter"]);

const CANCEL = "Escape";

type Push = { name: string; modal: boolean };

/** A binding with its effective keys. */
type Entry<Id extends string> = { binding: Binding<Id>; keys: Combo[] };

type Hit<Id extends string> = { entry: Entry<Id>; depth: number };

function canonicalKeys(keys: readonly Combo[]): Combo[] {
  const canonical: Combo[] = [];
  for (const key of keys) {
    const combo = parseCombo(key);
    if (combo !== null && !canonical.includes(combo)) canonical.push(combo);
  }
  return canonical;
}

function declaredKeys(binding: Binding<string>): Combo[] {
  for (const key of binding.keys) {
    if (parseCombo(key) === null) {
      throw new Error(
        `The binding "${binding.id}" has a key the grammar cannot read: "${key}".`
      );
    }
  }
  return canonicalKeys(binding.keys);
}

/** Every scope a binding answers in: its own, then its `alsoIn`. */
function answeringScopes(binding: Binding<string>): readonly string[] {
  return [binding.scope, ...(binding.alsoIn ?? [])];
}

function sameState(a: KeymapState, b: KeymapState): boolean {
  const sameList = <T>(x: T[], y: T[], same: (p: T, q: T) => boolean) =>
    x.length === y.length && x.every((item, i) => same(item, y[i] as T));
  const sameStrings = (x: string[], y: string[]) =>
    sameList(x, y, (p, q) => p === q);

  return (
    a.count === b.count &&
    sameStrings(a.scope, b.scope) &&
    sameStrings(a.pending, b.pending) &&
    sameList(
      a.candidates,
      b.candidates,
      (p, q) =>
        p.id === q.id && p.label === q.label && sameStrings(p.keys, q.keys)
    ) &&
    sameList(
      a.conflicts,
      b.conflicts,
      (p, q) =>
        p.scope === q.scope && p.combo === q.combo && sameStrings(p.ids, q.ids)
    )
  );
}

/**
 * A keyboard vocabulary: bindings resolved through a scope stack, with counts
 * (`5j`), two-press chords (`g t`), which-key candidates and overrides.
 *
 * - A scope answers while it is pushed and `"global"` always does; the
 *   innermost scope wins a combo two bindings share, and among equals the one
 *   declared last. A scope pushed as modal silences everything beneath it.
 *   A binding with `alsoIn` answers in each of those scopes too, at the
 *   deepest one pushed, so a scope pushed above a modal lets it through.
 * - A digit with no chord pending builds a count, unless it is a lone `0` or
 *   nothing countable answers, and runs its own binding if it has one (not
 *   one marked `yieldsToCount`, while the digit builds); the count goes to
 *   the next command if that one is countable and is dropped otherwise.
 *   Escape cancels a pending count or chord.
 * - A letter that opens a chord waits for its second key. A single binding on
 *   the same letter, in a scope no deeper than the chord's, runs when the
 *   window lapses with no second key or when the second key continues no
 *   chord; a second key that does runs the chord instead. A key that breaks a
 *   pending chord or count is consumed even when it then runs nothing.
 *
 * Framework-free and listener-free: the caller owns the one `keydown` listener
 * and hands each event to `dispatch`, and watches `state` through `subscribe`.
 */
export function createKeymap<Id extends string>(
  options: KeymapOptions<Id>
): Keymap<Id> {
  const windowMs = options.chordWindowMs ?? CHORD_WINDOW_MS;
  const takesRepeat = options.repeat ?? false;

  let declared = options.bindings;
  let overrides: KeymapOverrides = options.overrides ?? {};
  let entries: Entry<Id>[] = [];
  let effective: Binding<Id>[] = [];
  let byCombo = new Map<Combo, Entry<Id>[]>();
  let conflicts: KeymapConflict<Id>[] = [];

  const stack: Push[] = [];
  /** The first press of a chord waiting for its second. */
  let opener: Combo | null = null;
  /** The single on the opener's letter that runs if the chord does not. */
  let deferred: Id | null = null;
  let digits = "";
  let lastAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const listeners = new Set<() => void>();
  let snapshot: KeymapState<Id> | null = null;

  function build() {
    entries = declared.map((binding) => {
      const keys = declaredKeys(binding);
      const override = Object.hasOwn(overrides, binding.id)
        ? overrides[binding.id]
        : undefined;
      return { binding, keys: override ? canonicalKeys(override) : keys };
    });
    effective = entries.map(({ binding, keys }) => ({ ...binding, keys }));

    byCombo = new Map();
    const byScope = new Map<string, Map<Combo, Id[]>>();
    for (const entry of entries) {
      for (const combo of entry.keys) {
        byCombo.set(combo, [...(byCombo.get(combo) ?? []), entry]);
      }
      for (const scope of answeringScopes(entry.binding)) {
        const combos = byScope.get(scope) ?? new Map<Combo, Id[]>();
        byScope.set(scope, combos);
        for (const combo of entry.keys) {
          const ids = combos.get(combo) ?? [];
          if (!ids.includes(entry.binding.id)) ids.push(entry.binding.id);
          combos.set(combo, ids);
        }
      }
    }

    conflicts = [];
    for (const [scope, combos] of byScope) {
      for (const [combo, ids] of combos) {
        if (ids.length > 1) conflicts.push({ scope, combo, ids });
      }
    }
  }

  /**
   * How deeply a scope is nested, or 0 while it does not answer. The global
   * scope is the floor at 1; a push stands above it; a modal push silences
   * every scope whose innermost push lies beneath it.
   */
  function depthOf(scope: string): number {
    let floor = -1;
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i]?.modal) {
        floor = i;
        break;
      }
    }
    if (scope === GLOBAL_SCOPE) return floor === -1 ? 1 : 0;
    const index = stack.findLastIndex((push) => push.name === scope);
    return index === -1 || index < floor ? 0 : index + 2;
  }

  function answering(entry: Entry<Id>, typing: boolean): number {
    if (typing && !entry.binding.allowInInput) return 0;
    const depth = Math.max(...answeringScopes(entry.binding).map(depthOf));
    if (depth === 0) return 0;
    return (entry.binding.when?.() ?? true) ? depth : 0;
  }

  /** The binding a press of `combo` reaches now, if any. */
  function resolve(combo: Combo, typing = false): Hit<Id> | null {
    let hit: Hit<Id> | null = null;
    for (const entry of byCombo.get(combo) ?? []) {
      const depth = answering(entry, typing);
      if (depth > 0 && depth >= (hit?.depth ?? 0)) hit = { entry, depth };
    }
    return hit;
  }

  /** The depth of the deepest answering chord that opens on `press`, or 0. */
  function chordDepth(press: Combo): number {
    if (!CHORD_OPENER.test(press)) return 0;
    let deepest = 0;
    for (const [combo, bucket] of byCombo) {
      if (!combo.startsWith(`${press} `)) continue;
      for (const entry of bucket)
        deepest = Math.max(deepest, answering(entry, false));
    }
    return deepest;
  }

  const countsAnswer = () =>
    entries.some(
      (entry) => entry.binding.countable && answering(entry, false) > 0
    );

  const hasPending = () => opener !== null || digits !== "";

  function clear() {
    opener = null;
    deferred = null;
    digits = "";
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function arm() {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(lapse, windowMs);
  }

  function countFor(entry: Entry<Id>, count: string): number {
    return entry.binding.countable && count !== ""
      ? Math.max(1, Number(count))
      : 1;
  }

  /** Runs a command, which ends whatever was pending. */
  function run(entry: Entry<Id>, combo: Combo, count: string) {
    const applied = countFor(entry, count);
    clear();
    notify();
    options.onRun(entry.binding.id, { count: applied, combo });
  }

  /** Runs the single a chord's opener deferred, if it still answers. */
  function runDeferred(press: Combo, id: Id, count: string) {
    const hit = resolve(press);
    if (hit && hit.entry.binding.id === id) run(hit.entry, press, count);
  }

  /** The window ran out: the deferred single runs, the rest is dropped. */
  function lapse() {
    const press = opener;
    const id = deferred;
    const count = digits;
    clear();
    notify();
    if (press !== null && id !== null) runDeferred(press, id, count);
  }

  /** A press with no chord pending. `broke` says it ended a pending chord. */
  function press(combo: Combo, event: KeymapEvent, broke: boolean) {
    const consume = () => event.preventDefault?.();

    if (DIGIT.test(combo)) {
      const builds = (combo !== "0" || digits !== "") && countsAnswer();
      if (builds) {
        digits += combo;
        lastAt = Date.now();
        arm();
      }
      const hit = resolve(combo);
      if (hit || builds || broke) consume();
      notify();
      if (hit && !(builds && hit.entry.binding.yieldsToCount)) {
        options.onRun(hit.entry.binding.id, { count: 1, combo });
      }
      return;
    }

    const single = resolve(combo);
    const chord = chordDepth(combo);
    if (chord > 0 && chord >= (single?.depth ?? 0)) {
      if (single || broke || digits !== "") consume();
      opener = combo;
      deferred = single?.entry.binding.id ?? null;
      lastAt = Date.now();
      arm();
      notify();
      return;
    }

    if (single) {
      consume();
      run(single.entry, combo, digits);
      return;
    }

    if (broke || digits !== "") {
      consume();
      clear();
      notify();
    }
  }

  function dispatch(event: KeymapEvent) {
    if (event.defaultPrevented) return;
    if (event.repeat && !takesRepeat) return;

    const combo = canonicalCombo(event);
    if (combo === null) return;

    if (hasPending() && Date.now() - lastAt >= windowMs) lapse();

    const target = event.target ?? null;
    if (isTypingTarget(target)) {
      const hit = resolve(combo, true);
      if (!hit) return;
      event.preventDefault?.();
      run(hit.entry, combo, "");
      return;
    }

    if (ACTIVATION_KEYS.has(combo) && isActivationTarget(target, combo)) return;

    if (combo === CANCEL && hasPending()) {
      event.preventDefault?.();
      clear();
      notify();
      return;
    }

    if (opener === null) {
      press(combo, event, false);
      return;
    }

    const chord = `${opener} ${combo}`;
    const hit = resolve(chord);
    if (hit) {
      event.preventDefault?.();
      run(hit.entry, chord, digits);
      return;
    }

    const brokenOpener = opener;
    const brokenSingle = deferred;
    const count = digits;
    clear();
    if (brokenSingle !== null) runDeferred(brokenOpener, brokenSingle, count);
    press(combo, event, true);
  }

  function candidates(): KeymapCandidate<Id>[] {
    const listed: KeymapCandidate<Id>[] = [];
    for (const entry of entries) {
      const keys = entry.keys.filter((combo) => {
        if (opener !== null) {
          if (!combo.startsWith(`${opener} `)) return false;
        } else if (digits !== "" && !entry.binding.countable) {
          return false;
        }
        return resolve(combo)?.entry === entry;
      });
      if (keys.length > 0) {
        listed.push({ id: entry.binding.id, keys, label: entry.binding.label });
      }
    }
    return listed;
  }

  function state(): KeymapState<Id> {
    const next: KeymapState<Id> = {
      scope: [GLOBAL_SCOPE, ...stack.map((push) => push.name)],
      pending: opener === null ? [] : [opener],
      count: digits === "" ? null : Number(digits),
      candidates: candidates(),
      conflicts,
    };
    if (snapshot === null || !sameState(snapshot, next)) snapshot = next;
    return snapshot;
  }

  function pushScope(name: string, scopeOptions: ScopeOptions = {}) {
    const push: Push = { name, modal: scopeOptions.modal ?? false };
    stack.push(push);
    notify();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const index = stack.indexOf(push);
      if (index !== -1) stack.splice(index, 1);
      notify();
    };
  }

  function popScope(name: string) {
    const index = stack.findLastIndex((push) => push.name === name);
    if (index === -1) return;
    stack.splice(index, 1);
    notify();
  }

  build();

  return {
    dispatch,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    state,
    pushScope,
    popScope,
    setOverrides(next) {
      overrides = next;
      build();
      notify();
    },
    setBindings(next) {
      declared = next;
      build();
      notify();
    },
    bindings: () => effective,
    reset() {
      clear();
      notify();
    },
  };
}
