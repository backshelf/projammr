import { useId, useState, type JSX } from "react";
import { Button } from "@workspace/ui/components/button";
import { Kbd } from "@workspace/ui/components/kbd";
import { Textarea } from "@workspace/ui/components/textarea";
import { TogglePill } from "@workspace/ui/components/toggle-pill";

import { call } from "../bridge";
import { useCommitShortcut } from "../commit-shortcut";
import { ErrorLine } from "../error-line";
import { useFocusTarget } from "../focus-target";
import type { Clause } from "../ipc";
import { useCommand } from "../use-command";
import {
  following,
  isOn,
  toggled,
  typed,
  untouched,
  written,
  type Composer,
} from "./suggestion";

/** Where the box starts: the draft the app holds for this set, else the suggestion whole. */
function startingBox(clauses: readonly Clause[], appDraft: string): Composer {
  return appDraft === "" ? untouched(clauses) : written(appDraft);
}

/**
 * The commit box: the message in a textarea, the suggestion's clauses as chips that drop their words from it and put
 * them back, the line that says what a commit is for, the refusal when the commit is turned down, and the button
 * (`⌘↩` does the same). Key it by the set and its head commit: its draft belongs to the app (`set_draft` /
 * `Snapshot.draft`), so screen changes keep what was written and any commit (from the panel or the cli) clears it.
 * Until the person types, the text is the suggestion and follows it as saves arrive; once they have, the text is
 * theirs.
 */
export function CommitBox({
  set,
  clauses,
  appDraft,
  firstCommit,
}: {
  /** The set file's path, which names the draft and the commit. */
  set: string;
  clauses: readonly Clause[];
  /** The text the app holds for the set; empty when there is no draft. */
  appDraft: string;
  firstCommit: boolean;
}): JSX.Element {
  const helpId = useId();
  const errorId = useId();
  const focusTarget = useFocusTarget();
  const { run, pending, error } = useCommand();
  const [kept, setKept] = useState(() => startingBox(clauses, appDraft));
  const box = following(kept, clauses);

  function change(next: Composer): void {
    setKept(next);
    const persisted = next.edited || next.dropped.length > 0 ? next.text : "";
    void call("set_draft", { set, message: persisted });
  }

  async function commit(): Promise<void> {
    if (pending) return;
    await run(() => call("commit", { set, message: box.text }));
  }

  useCommitShortcut(() => void commit());

  return (
    <div className="flex flex-col gap-3">
      <Textarea
        ref={focusTarget}
        aria-label="Commit message"
        aria-describedby={`${helpId}${error === null ? "" : ` ${errorId}`}`}
        aria-invalid={error !== null || undefined}
        rows={2}
        value={box.text}
        placeholder={firstCommit ? "Initial commit" : "What changed"}
        className="min-h-14 text-small"
        onChange={(event) => change(typed(box, event.target.value))}
      />
      {clauses.length > 0 && (
        <ul aria-label="Suggested message" className="flex flex-wrap gap-1.5">
          {clauses.map((clause) => (
            <li key={clause.text} className="max-w-full">
              <TogglePill
                pressed={isOn(box, clause)}
                onPressedChange={() => change(toggled(box, clauses, clause))}
                className="min-h-7 max-w-full text-left data-pressed:bg-transparent data-pressed:text-art"
              >
                {clause.text}
              </TogglePill>
            </li>
          ))}
        </ul>
      )}
      <ErrorLine error={error} id={errorId} />
      <p id={helpId} className="text-small text-pretty text-ink-soft">
        A commit names the set as it is now, so you can find it later.
      </p>
      <div className="flex justify-end">
        <Button size="lg" disabled={pending} onClick={() => void commit()}>
          Commit
          <Kbd variant="bare" className="text-inherit opacity-70">
            {"\u2318\u21a9"}
          </Kbd>
        </Button>
      </div>
    </div>
  );
}
