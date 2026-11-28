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
import { IconPencil, IconX } from "@tabler/icons-react";
import type { ActionError } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { IconButton } from "@workspace/ui/components/icon-button";
import { Loading } from "@workspace/ui/components/layout/loading";
import {
  ResponsivePicker,
  ResponsivePickerContent,
  ResponsivePickerCreate,
  ResponsivePickerEmpty,
  ResponsivePickerItem,
  ResponsivePickerList,
  ResponsivePickerSearch,
  ResponsivePickerTrigger,
} from "@workspace/ui/components/responsive-picker";
import { Separator } from "@workspace/ui/components/separator";
import { REVEAL_ON_HOVER } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { Fragment, use, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

type Vocabulary = Promise<string[] | ActionError>;

const NO_ARTISTS: string[] = [];

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
    <span className={"group inline-flex flex-wrap items-center"}>
      {credited.length > 0 && (
        <span>
          {keyedCredits(credited).map(({ artist, key }, index) => (
            <Fragment key={key}>
              {index > 0 && ", "}
              <AppLink
                href={withFilters(tracksHref, { artist })}
                className={
                  "rounded-sm underline-offset-2 motion-ink hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden coarse:inline-flex coarse:min-h-11 coarse:items-center"
                }
              >
                {artist}
              </AppLink>
            </Fragment>
          ))}
        </span>
      )}
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
    <ResponsivePicker closeOnSelect={false}>
      <ResponsivePickerTrigger asChild>
        {credited.length > 0 ? (
          <IconButton
            aria-label={"Edit artists"}
            className={cn(
              "ml-1 size-6 [&_svg]:size-3.5",
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
              "rounded-sm text-ink-faint italic motion-ink hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden coarse:min-h-11"
            }
          >
            Add artists
          </button>
        )}
      </ResponsivePickerTrigger>
      <ResponsivePickerContent
        title="Artists"
        align={"start"}
        desktopClassName={"w-64 p-2"}
      >
        <Loading>
          <ArtistPickerBody
            vocabulary={vocabulary}
            credited={credited}
            disabled={disabled}
            onChange={onChange}
          />
        </Loading>
      </ResponsivePickerContent>
    </ResponsivePicker>
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
                  "flex items-center gap-2 rounded px-1.5 py-0.5 text-small coarse:min-h-11 coarse:text-body"
                }
              >
                <span className={"min-w-0 flex-1 truncate"}>{artist}</span>
                <IconButton
                  aria-label={`Remove ${artist}`}
                  disabled={disabled}
                  onClick={() =>
                    onChange(credited.filter((_, i) => i !== index))
                  }
                  className={
                    "size-6 coarse:size-11 coarse:after:inset-0 [&_svg]:size-3.5"
                  }
                >
                  <IconX />
                </IconButton>
              </li>
            ))}
          </ul>
          <Separator className={"my-1"} />
        </>
      )}
      <ResponsivePickerSearch
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || disabled) return;
          e.preventDefault();
          add(draft);
        }}
        placeholder={"Filter or add artist…"}
        aria-label={"Filter or add artist"}
        className={"h-7"}
      />
      <ResponsivePickerList className={"max-h-56"}>
        {matches.map((artist) => (
          <ResponsivePickerItem
            key={artist}
            disabled={disabled}
            onSelect={() => add(artist)}
          >
            {artist}
          </ResponsivePickerItem>
        ))}
        {create && (
          <ResponsivePickerCreate
            disabled={disabled}
            onSelect={() => add(create)}
          >
            Add “{create}”
          </ResponsivePickerCreate>
        )}
        {matches.length === 0 && !create && (
          <ResponsivePickerEmpty>
            {draft.trim() ? "Already credited." : "No other artists yet."}
          </ResponsivePickerEmpty>
        )}
      </ResponsivePickerList>
    </>
  );
}
