import { MENU_LABEL, OVERLAY_SURFACE } from "@workspace/ui/lib/overlay";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

/** One line a prompt offers: what it says, and what choosing it does. */
export type CommandBarSuggestion = {
  id: string;
  label: string;
  /** Quiet text at the line's end: where it goes, what kind it is. */
  hint?: string;
  run: () => void;
};

/**
 * A typed line in the bar (`:merge Night Bus`). The caller owns the text and
 * the suggestions it offers for it; the bar owns which suggestion is active.
 */
export type CommandBarPrompt = {
  open: boolean;
  value: string;
  onChange: (value: string) => void;
  /** Enter with no suggestion offered: the typed line. Without it, Enter waits. */
  onSubmit?: (value: string) => void;
  suggestions: readonly CommandBarSuggestion[];
  /** Escape, focus leaving the line, or a choice made. */
  onClose: () => void;
  /** The character the line starts with. Defaults to `:`. */
  lead?: string;
  placeholder?: string;
};

export function PromptLine({
  prompt,
  position,
}: {
  prompt: CommandBarPrompt;
  position: "bottom" | "top";
}) {
  const {
    value,
    onChange,
    onSubmit,
    onClose,
    suggestions,
    lead = ":",
    placeholder,
  } = prompt;
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();
  const optionId = (index: number) => `${listId}-${index}`;

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const choose = (index: number) => {
    const suggestion = suggestions[index];
    if (suggestion) {
      suggestion.run();
      onClose();
    } else if (onSubmit) {
      onSubmit(value);
      onClose();
    }
  };

  const offered = suggestions.length > 0;

  return (
    <div className="relative flex h-full flex-1 items-center gap-2">
      {offered && (
        <ul
          id={listId}
          role="listbox"
          aria-label={placeholder}
          className={cn(
            OVERLAY_SURFACE,
            "absolute left-0 max-h-80 w-[min(34rem,100%)] overflow-y-auto p-1",
            position === "top" ? "top-full mt-2" : "bottom-full mb-2"
          )}
        >
          {suggestions.map((suggestion, i) => (
            <li
              key={suggestion.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(i);
              }}
              className={cn(
                "flex cursor-pointer items-baseline justify-between gap-4 rounded-sm px-2.5 py-1.5 text-small",
                i === active
                  ? "bg-[color-mix(in_oklab,var(--ink)_8%,transparent)] text-ink"
                  : "text-ink-soft"
              )}
            >
              <span className="truncate">{suggestion.label}</span>
              {suggestion.hint && (
                <span className={cn(MENU_LABEL, "shrink-0")}>
                  {suggestion.hint}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <span aria-hidden className="font-sub text-small text-ink">
        {lead}
      </span>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={placeholder}
        aria-autocomplete="list"
        aria-expanded={offered}
        aria-controls={offered ? listId : undefined}
        aria-activedescendant={
          suggestions[active] ? optionId(active) : undefined
        }
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(0);
        }}
        placeholder={placeholder}
        className="h-full min-w-0 flex-1 bg-transparent font-mono text-small text-ink outline-none placeholder:text-ink-faint"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(active);
          } else if (
            event.key === "ArrowDown" ||
            (event.key === "n" && event.ctrlKey)
          ) {
            event.preventDefault();
            setActive((i) => Math.min(suggestions.length - 1, i + 1));
          } else if (
            event.key === "ArrowUp" ||
            (event.key === "p" && event.ctrlKey)
          ) {
            event.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (event.key === "Tab" && suggestions[active]) {
            event.preventDefault();
            onChange(suggestions[active].label);
          }
        }}
        onBlur={onClose}
      />
      <span aria-hidden className={cn(LABEL, "shrink-0 text-ink-faint")}>
        ↵ choose · esc close
      </span>
    </div>
  );
}
