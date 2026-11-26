"use client";

import { AppLink } from "@/components/navigation/AppLink";
import {
  artistOptions,
  creditArtist,
  keyedCredits,
} from "@/components/track/artist-credits";
import { patchEntityFields } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { useProject } from "@/hooks/use-project-role";
import { withFilters } from "@/lib/table-params";
import { hrefFromParsedRoute } from "@/lib/utils";
import { IconPencil, IconPlus, IconX } from "@tabler/icons-react";
import type { ActionError } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Input } from "@workspace/ui/components/input";
import { Loading } from "@workspace/ui/components/layout/loading";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Separator } from "@workspace/ui/components/separator";
import { REVEAL_ON_HOVER } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { Fragment, use, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

type Vocabulary = Promise<string[] | ActionError>;

const NO_ARTISTS: string[] = [];

const OPTION =
  "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-small hover:bg-ink/4 disabled:opacity-50";

/**
 * A track's credited artists in the masthead byline, each linking to the
 * tracks list filtered to that artist. Given the project's artists, it also
 * opens a picker that credits and uncredits them in place.
 */
export function TrackArtists({
  trackId,
  artists,
  vocabulary,
}: {
  trackId: number;
  artists: string[];
  /** The project's artists, which the picker suggests. Passed only to someone
   *  who can edit the track; without it the artists are links and nothing more. */
  vocabulary?: Vocabulary;
}) {
  const { id: projectId } = useProject();
  const mutate = useMutate();
  const [credited, setCredited] = useOptimistic(artists);
  const [pending, startTransition] = useTransition();

  const save = (next: string[]) =>
    startTransition(async () => {
      setCredited(next);
      const result = await mutate(
        patchEntityFields("track", trackId, { artists: next })
      );
      if (isActionError(result)) {
        toast.error(`Failed to update artists: ${result.error}`);
      }
    });

  if (credited.length === 0 && !vocabulary) return null;

  const tracksHref = hrefFromParsedRoute({ kind: "track-all" }, projectId);

  return (
    <span className={"group"}>
      {keyedCredits(credited).map(({ artist, key }, index) => (
        <Fragment key={key}>
          {index > 0 && ", "}
          <AppLink
            href={withFilters(tracksHref, { artist })}
            className={
              "rounded-sm underline-offset-2 motion-ink hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-none coarse:inline-flex coarse:min-h-11 coarse:items-center"
            }
          >
            {artist}
          </AppLink>
        </Fragment>
      ))}
      {vocabulary && (
        <ArtistPicker
          vocabulary={vocabulary}
          credited={credited}
          disabled={pending}
          onChange={save}
        />
      )}
    </span>
  );
}

function ArtistPicker({
  vocabulary,
  credited,
  disabled,
  onChange,
}: {
  vocabulary: Vocabulary;
  credited: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {credited.length > 0 ? (
          <IconButton
            aria-label={"Edit artists"}
            className={cn(
              "ml-1 size-6 align-middle [&_svg]:size-3.5",
              REVEAL_ON_HOVER,
              "fine:aria-expanded:opacity-100"
            )}
          >
            <IconPencil />
          </IconButton>
        ) : (
          <button
            type={"button"}
            className={
              "rounded-sm text-ink-faint italic motion-ink hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-none coarse:min-h-11"
            }
          >
            Add artists
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align={"start"} className={"w-64 p-2"}>
        <Loading>
          <ArtistPickerBody
            vocabulary={vocabulary}
            credited={credited}
            disabled={disabled}
            onChange={onChange}
          />
        </Loading>
      </PopoverContent>
    </Popover>
  );
}

/** Suspends on the project's artists, so the picker can open before they arrive. */
function ArtistPickerBody({
  vocabulary,
  credited,
  disabled,
  onChange,
}: {
  vocabulary: Vocabulary;
  credited: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const resolved = use(vocabulary);
  const known = isActionError(resolved) ? NO_ARTISTS : resolved;
  const [draft, setDraft] = useState("");
  const { matches, create } = artistOptions(known, credited, draft);

  const add = (name: string) => {
    setDraft("");
    const next = creditArtist(known, credited, name);
    if (next !== credited) onChange(next);
  };

  return (
    <>
      {credited.length > 0 && (
        <>
          <ul aria-label={"Credited artists"} className={"space-y-0.5"}>
            {keyedCredits(credited).map(({ artist, key }, index) => (
              <li
                key={key}
                className={
                  "flex items-center gap-2 rounded px-1.5 py-0.5 text-small"
                }
              >
                <span className={"min-w-0 flex-1 truncate"}>{artist}</span>
                <IconButton
                  aria-label={`Remove ${artist}`}
                  disabled={disabled}
                  onClick={() =>
                    onChange(credited.filter((_, i) => i !== index))
                  }
                  className={"size-5 [&_svg]:size-3.5"}
                >
                  <IconX />
                </IconButton>
              </li>
            ))}
          </ul>
          <Separator className={"my-2"} />
        </>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || disabled) return;
          e.preventDefault();
          add(draft);
        }}
        placeholder={"Filter or add artist…"}
        aria-label={"Filter or add artist"}
        className={"mb-2 h-7 text-small"}
        autoFocus
      />
      <div className={"max-h-56 space-y-0.5 overflow-y-auto"}>
        {matches.map((artist) => (
          <button
            key={artist}
            type={"button"}
            disabled={disabled}
            onClick={() => add(artist)}
            className={OPTION}
          >
            <span className={"truncate"}>{artist}</span>
          </button>
        ))}
        {create && (
          <button
            type={"button"}
            disabled={disabled}
            onClick={() => add(create)}
            className={OPTION}
          >
            <IconPlus size={14} />
            Add “{create}”
          </button>
        )}
        {matches.length === 0 && !create && (
          <p className={"px-1.5 py-1 text-small text-ink-soft"}>
            {draft.trim() ? "Already credited." : "No other artists yet."}
          </p>
        )}
      </div>
    </>
  );
}
