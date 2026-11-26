import {
  useEffect,
  useId,
  useRef,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
} from "@workspace/ui/components/layout/rows";
import { Progress } from "@workspace/ui/components/progress";
import { cn } from "@workspace/ui/lib/utils";

/** One folder as the list shows it. */
export type FolderListRow = {
  path: string;
  title: string;
  /** The line under the title: its facts, its state or its reason. */
  meta: string | null;
  /** The folder's progress line under the row, 0 to 100; none when there is nothing to measure. */
  progress?: number | null;
  /** The icon in front of a row that has no tick. */
  lead?: ReactNode;
  /** Whether the row can be ticked: a folder that is a repo already is listed and left alone. */
  tickable?: boolean;
};

export type FolderTicks = {
  /** The paths the person has unticked; every other tickable folder is ticked. */
  unticked: ReadonlySet<string>;
  onToggle: (path: string) => void;
};

/**
 * The folders of the window, one tab stop: `↑/↓`, `Home` and `End` move the chosen folder, `Space` ticks it when the
 * list has ticks, and `↩` is the step's primary action. It is a listbox whose focus stays on the list and whose
 * active option is the chosen folder; with ticks, the ticked folders are its selected options.
 */
export function FolderList({
  label,
  rows,
  chosen,
  onChoose,
  ticks,
  onPrimary,
  autoFocus,
}: {
  label: string;
  rows: readonly FolderListRow[];
  /** The path of the chosen folder, whose sets the right side shows. */
  chosen: string | null;
  onChoose: (path: string) => void;
  ticks?: FolderTicks;
  onPrimary?: () => void;
  /** Takes focus when it appears: the step's first control. (React's `autoFocus` skips a list.) */
  autoFocus?: boolean;
}): JSX.Element {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const optionId = (index: number): string => `${listId}-${index}`;
  const chosenIndex = rows.findIndex((row) => row.path === chosen);

  useEffect(() => {
    if (autoFocus) listRef.current?.focus();
  }, [autoFocus]);

  // A chosen folder that the list has scrolled away from comes back into view.
  useEffect(() => {
    listRef.current
      ?.querySelector("[data-chosen]")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [chosen]);

  function move(to: number): void {
    const row = rows[Math.max(0, Math.min(rows.length - 1, to))];
    if (row && row.path !== chosen) onChoose(row.path);
  }

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>): void {
    switch (event.key) {
      case "ArrowDown":
        move(chosenIndex + 1);
        break;
      case "ArrowUp":
        move(chosenIndex < 0 ? 0 : chosenIndex - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      case " ": {
        const row = rows[chosenIndex];
        if (ticks && row?.tickable) ticks.onToggle(row.path);
        break;
      }
      case "Enter":
        onPrimary?.();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label={label}
      aria-multiselectable={ticks ? true : undefined}
      aria-activedescendant={
        chosenIndex >= 0 ? optionId(chosenIndex) : undefined
      }
      tabIndex={0}

      onKeyDown={onKeyDown}
      className="group/list flex flex-col outline-none"
    >
      {rows.map((row, index) => {
        const isChosen = row.path === chosen;
        const ticked =
          ticks !== undefined && row.tickable && !ticks.unticked.has(row.path);
        return (
          <Row
            key={row.path}
            as="li"
            role="option"
            id={optionId(index)}
            aria-selected={ticks ? ticked : isChosen}
            aria-disabled={ticks && !row.tickable ? true : undefined}
            data-chosen={isChosen ? "" : undefined}
            title={row.path}
            onClick={() => onChoose(row.path)}
            className={cn(
              "cursor-default items-start gap-2.5 px-3 py-2 first:border-t-0",
              "data-[chosen]:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)]",
              "group-focus-visible/list:data-[chosen]:ring-2 group-focus-visible/list:data-[chosen]:ring-ring/40 group-focus-visible/list:data-[chosen]:ring-inset"
            )}
          >
            {ticks ? (
              <Checkbox
                aria-hidden
                tabIndex={-1}
                checked={ticked}
                disabled={!row.tickable}
                onChange={() => ticks.onToggle(row.path)}
                className="mt-1"
              />
            ) : (
              <span className="mt-0.5 flex w-4 shrink-0 justify-center text-ink-soft">
                {row.lead}
              </span>
            )}
            <RowMain className="flex flex-col gap-0.5">
              <RowTitle
                className={cn(ticks && !row.tickable && "text-ink-soft")}
              >
                {row.title}
              </RowTitle>
              {row.meta !== null && (
                <RowMeta className="whitespace-normal">{row.meta}</RowMeta>
              )}
              {row.progress != null && (
                <Progress aria-hidden value={row.progress} className="mt-1.5" />
              )}
            </RowMain>
          </Row>
        );
      })}
    </ul>
  );
}
