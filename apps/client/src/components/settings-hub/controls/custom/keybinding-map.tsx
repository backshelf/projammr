"use client";

import { IconRestore, IconX } from "@tabler/icons-react";
import { groupByHeading } from "@/components/hotkeys/shortcut-groups";
import { ComboCaps } from "@/components/hotkeys/combo-caps";
import { Button } from "@workspace/ui/components/button";
import { ConfirmDeleteDialog } from "@workspace/ui/components/confirm-delete-dialog";
import { IconButton } from "@workspace/ui/components/icon-button";
import { useIsApplePlatform } from "@workspace/ui/hooks/use-apple-platform";
import { MENU_LABEL } from "@workspace/ui/lib/overlay";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { z } from "zod";
import { describedByOf, labelIdOf, type CustomSettingControl } from "../types";
import {
  keyCommandsFor,
  withKeys,
  withoutOverride,
  type KeyMapCommand,
} from "./keybinding-commands";
import { KeyCapture } from "./key-capture";
import {
  checkBinding,
  conflicts,
  effectiveKeys,
  refusalText,
  unknownOverrideIds,
  type KeyOverrides,
} from "./keybinding-rules";

const overridesSchema = z.record(z.string(), z.array(z.string()));

/** The keys a command answers to, as caps; a word when it has none. */
function KeyCaps({ keys, apple }: { keys: readonly string[]; apple: boolean }) {
  if (keys.length === 0) {
    return <span className="text-small text-ink-faint">Unbound</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {keys.map((combo) => (
        <ComboCaps
          key={combo}
          combo={combo}
          apple={apple}
          capClassName="text-ink-soft"
        />
      ))}
    </span>
  );
}

/** A heading and the list of rows it labels. */
function KeySection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className={MENU_LABEL}>
        {heading}
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

/**
 * One command: its label, its keys and the ways to change them. A refusal of
 * a change shows under the row and nothing is written; a clash already in the
 * stored value shows as a note that blocks nothing.
 */
function KeyRow({
  command,
  keys,
  overridden,
  apple,
  readOnly,
  notes,
  onBind,
  onReset,
}: {
  command: KeyMapCommand;
  keys: readonly string[];
  overridden: boolean;
  apple: boolean;
  /** No actions: the setting is locked, or the command is fixed. */
  readOnly: boolean;
  notes: readonly string[];
  /** Binds `keys` to the command; the refusal's text when it may not be. */
  onBind: (keys: readonly string[]) => string | null;
  onReset: () => void;
}) {
  const [capturing, setCapturing] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const changeRef = useRef<HTMLButtonElement>(null);
  const wasCapturingRef = useRef(false);

  // Closing the capture unmounts the button that had focus; put focus back on
  // Change unless the user has already moved it somewhere on purpose.
  useEffect(() => {
    const active = document.activeElement;
    if (
      wasCapturingRef.current &&
      !capturing &&
      (active === null || active === document.body)
    ) {
      changeRef.current?.focus();
    }
    wasCapturingRef.current = capturing;
  }, [capturing]);

  const stop = () => {
    setCapturing(false);
    setRefusal(null);
  };

  const bind = (next: readonly string[]) => {
    const problem = onBind(next);
    if (problem === null) stop();
    else setRefusal(problem);
    return problem;
  };

  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 basis-40 text-small text-ink">
          {command.label}
        </span>
        {capturing ? (
          <KeyCapture
            apple={apple}
            label={command.label}
            autoFocus
            onCapture={(combo) => bind([combo])}
            onCancel={stop}
          />
        ) : (
          <KeyCaps keys={keys} apple={apple} />
        )}
        {!readOnly && !capturing && (
          <span className="flex items-center gap-1">
            <Button
              ref={changeRef}
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Change keys for ${command.label}`}
              onClick={() => {
                setRefusal(null);
                setCapturing(true);
              }}
            >
              Change
            </Button>
            {keys.length > 0 && (
              <IconButton
                aria-label={`Remove keys for ${command.label}`}
                onClick={() => bind([])}
              >
                <IconX aria-hidden />
              </IconButton>
            )}
            {overridden && (
              <IconButton
                aria-label={`Reset keys for ${command.label}`}
                onClick={() => {
                  setRefusal(null);
                  onReset();
                }}
              >
                <IconRestore aria-hidden />
              </IconButton>
            )}
          </span>
        )}
      </div>
      {overridden && (
        <span className="flex items-center gap-2 text-small text-ink-faint">
          Default:
          <KeyCaps keys={command.defaults} apple={apple} />
        </span>
      )}
      {refusal !== null && (
        <p role="alert" className="text-small text-pretty text-danger">
          {refusal}
        </p>
      )}
      {notes.map((note) => (
        <p
          key={note}
          role="status"
          className="text-small text-pretty text-ink-soft"
        >
          {note}
        </p>
      ))}
    </li>
  );
}

/**
 * The keys of one keybinding setting, a row per command under its group's
 * heading. A change replaces the command's keys with the one captured combo,
 * is checked against the rules before it is written, and goes up through
 * `onChange` as the whole record; a row back at its defaults leaves the record.
 * Ids the record holds for commands that no longer exist are listed at the
 * end so they can be cleared.
 */
export const KeybindingMapControl: CustomSettingControl = ({
  definition,
  value,
  onChange,
  disabled,
  id,
}) => {
  const parsed = overridesSchema.safeParse(value);
  const overrides: KeyOverrides = parsed.success ? parsed.data : {};
  const commands = keyCommandsFor(definition.key);
  const apple = useIsApplePlatform();
  const [confirmingReset, setConfirmingReset] = useState(false);

  const notesById = new Map<string, string[]>();
  for (const { id: commandId, refusal } of conflicts(commands, overrides)) {
    const notes = notesById.get(commandId) ?? [];
    notes.push(refusalText(refusal, apple));
    notesById.set(commandId, notes);
  }
  const unknownIds = unknownOverrideIds(commands, overrides);
  const changed = Object.keys(overrides).length > 0;

  const bind = (command: KeyMapCommand, keys: readonly string[]) => {
    const refusal = checkBinding(commands, overrides, command.id, keys);
    if (refusal) return refusalText(refusal, apple);
    onChange(withKeys(overrides, command, keys));
    return null;
  };

  return (
    <div
      id={id}
      role="group"
      aria-labelledby={labelIdOf(id)}
      aria-describedby={describedByOf(id)}
      data-setting={definition.key}
      className="flex w-[min(100%,36rem)] flex-col gap-4"
    >
      {changed && !disabled && (
        <div className="flex items-center justify-between gap-3 text-small text-ink-soft">
          <span>{Object.keys(overrides).length} changed</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingReset(true)}
          >
            Reset all to defaults
          </Button>
        </div>
      )}
      {groupByHeading(commands).map(([group, rows]) => (
        <KeySection key={group} heading={group}>
          {rows.map((command) => (
            <KeyRow
              key={command.id}
              command={command}
              keys={effectiveKeys(command, overrides)}
              overridden={Object.hasOwn(overrides, command.id)}
              apple={apple}
              readOnly={disabled || command.fixed === true}
              notes={notesById.get(command.id) ?? []}
              onBind={(keys) => bind(command, keys)}
              onReset={() => onChange(withoutOverride(overrides, command.id))}
            />
          ))}
        </KeySection>
      ))}
      {unknownIds.length > 0 && (
        <KeySection heading="Unknown commands">
          {unknownIds.map((unknownId) => (
            <li
              key={unknownId}
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
            >
              <span className="min-w-0 flex-1 basis-40 text-small text-ink-soft">
                {unknownId}
              </span>
              <KeyCaps keys={overrides[unknownId] ?? []} apple={apple} />
              {!disabled && (
                <IconButton
                  aria-label={`Remove ${unknownId}`}
                  onClick={() =>
                    onChange(withoutOverride(overrides, unknownId))
                  }
                >
                  <IconX aria-hidden />
                </IconButton>
              )}
            </li>
          ))}
        </KeySection>
      )}
      <ConfirmDeleteDialog
        open={confirmingReset}
        onOpenChange={setConfirmingReset}
        title="Reset all shortcuts to their defaults?"
        description="Every key you changed goes back to the one it shipped with."
        confirmLabel="Reset all"
        onConfirm={() => onChange({})}
      />
    </div>
  );
};
