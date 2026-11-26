import { useId, useMemo, useState, type JSX } from "react";
import { Button } from "@workspace/ui/components/button";
import { Field, FieldLabel } from "@workspace/ui/components/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";

import { call } from "../bridge";
import { ErrorLine } from "../error-line";
import type { AdoptOffer } from "../ipc";
import { PanelHead } from "../panel-head";
import { useCommand } from "../use-command";

/** The project the offer starts on: the one last tracked into, else the only one there is. The app reads the list from the hub after the offer appears, so this is asked again with each snapshot. */
function startingProject(offer: AdoptOffer): string {
  const only = offer.projects.length === 1 ? offer.projects[0] : undefined;
  const id = offer.projectId ?? only?.id;
  return id === undefined ? "" : String(id);
}

/**
 * Live opened a set in a folder dit does not track. The folder's facts, the project it would be tracked into, and
 * the two answers: "Track it" and "Not now".
 */
export function Adopt({ offer }: { offer: AdoptOffer }): JSX.Element {
  const projectId = useId();
  const [picked, setPicked] = useState<string | null>(null);
  const project = picked ?? startingProject(offer);
  const { run, pending, error } = useCommand();
  const items = useMemo(
    () =>
      offer.projects.map((entry) => ({
        value: String(entry.id),
        label: entry.name,
      })),
    [offer.projects]
  );

  return (
    <div className="flex flex-col gap-4">
      <PanelHead
        title="Track this project?"
        lede={`${offer.name} has ${offer.setCount === 1 ? "1 set" : `${offer.setCount} sets`}. dit keeps every save and lets you name the ones that matter.`}
      />
      {offer.syncedBy !== null && (
        <p
          role="status"
          className="border-l border-rule-strong pl-3 text-small text-pretty text-ink-soft"
        >
          This folder is synced by {offer.syncedBy}. Two computers sharing one
          repo will corrupt it.
        </p>
      )}
      <Field>
        <FieldLabel htmlFor={projectId}>Project</FieldLabel>
        {items.length === 0 ? (
          <p id={projectId} className="text-small text-ink-soft">
            No project to track this folder into.
          </p>
        ) : (
          <Select items={items} value={project} onValueChange={setPicked}>
            <SelectTrigger id={projectId} className="w-full">
              <SelectValue placeholder="Choose a project" />
            </SelectTrigger>
            <SelectContent className="min-w-(--anchor-width)">
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <ErrorLine error={error} />
      <div className="flex items-center gap-2">
        <Button
          size="lg"
          disabled={pending || project === ""}
          onClick={() =>
            void run(() =>
              call("adopt", {
                folder: offer.folder,
                projectId: Number(project),
              })
            )
          }
        >
          Track it
        </Button>
        <Button
          size="lg"
          variant="outline"
          disabled={pending}
          onClick={() =>
            void run(() => call("decline_folder", { folder: offer.folder }))
          }
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
