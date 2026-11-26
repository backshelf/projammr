import type { JSX } from "react";
import { IconX } from "@tabler/icons-react";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Row, Rows } from "@workspace/ui/components/layout/rows";

/** One remembered decision: what to call it, where it is, and how to say it is forgotten. */
export type Forgettable = {
  key: string;
  title: string;
  /** The folder, in faint ink under the title; absent when it is not known. */
  detail?: string | null;
};

/**
 * Decisions the person made on a card ("Not a bounce", "Never here"), each removable. A name and a path are wrapped,
 * never cut: their tails tell two of them apart.
 */
export function ForgetList({
  labelledBy,
  items,
  empty,
  onForget,
}: {
  /** The id of the element that names the list. */
  labelledBy: string;
  items: readonly Forgettable[];
  empty: string;
  onForget: (item: Forgettable) => void;
}): JSX.Element {
  if (items.length === 0) {
    return <p className="text-micro text-ink-faint">{empty}</p>;
  }
  return (
    <Rows as="ul" aria-labelledby={labelledBy} className="border-b border-rule">
      {items.map((item) => (
        <Row key={item.key} as="li" className="gap-2 px-0 py-1">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="font-mono text-micro break-all text-ink-soft">
              {item.title}
            </span>
            {item.detail && (
              <span className="font-mono text-micro break-all text-ink-faint">
                {item.detail}
              </span>
            )}
          </span>
          <IconButton
            aria-label={`Forget ${item.title}`}
            onClick={() => onForget(item)}
          >
            <IconX />
          </IconButton>
        </Row>
      ))}
    </Rows>
  );
}
