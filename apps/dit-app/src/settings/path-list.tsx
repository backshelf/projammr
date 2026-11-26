import type { JSX } from "react";
import { IconFolderPlus, IconX } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Row, Rows } from "@workspace/ui/components/layout/rows";

import { pickFolders } from "../bridge";
import { describeFailure } from "../use-command";

/**
 * A list of folders the person can remove from and add to with the system's folder picker. A path is wrapped, never
 * cut: its tail is the part that tells two folders apart.
 */
export function PathList({
  id,
  labelledBy,
  paths,
  onChange,
  onError,
}: {
  id: string;
  /** The id of the element that names the list. */
  labelledBy: string;
  paths: string[];
  onChange: (paths: string[]) => void;
  /** Hears why the folder picker failed, or null when the next attempt starts. */
  onError?: (error: string | null) => void;
}): JSX.Element {
  async function add(): Promise<void> {
    onError?.(null);
    try {
      const picked = await pickFolders();
      const added = picked.filter((path) => !paths.includes(path));
      if (added.length > 0) onChange([...paths, ...added]);
    } catch (reason) {
      onError?.(describeFailure(reason));
    }
  }

  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className="flex flex-col gap-2"
    >
      {paths.length > 0 && (
        <Rows as="ul" className="border-b border-rule">
          {paths.map((path) => (
            <Row key={path} as="li" className="gap-2 px-0 py-1">
              <span className="min-w-0 flex-1 font-mono text-micro break-all text-ink-soft">
                {path}
              </span>
              <IconButton
                aria-label={`Remove ${path}`}
                onClick={() =>
                  onChange(paths.filter((other) => other !== path))
                }
              >
                <IconX />
              </IconButton>
            </Row>
          ))}
        </Rows>
      )}
      <Button
        id={id}
        variant="outline"
        className="self-start"
        onClick={() => void add()}
      >
        <IconFolderPlus />
        Add folder…
      </Button>
    </div>
  );
}
