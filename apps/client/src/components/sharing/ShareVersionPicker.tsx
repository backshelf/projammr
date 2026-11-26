"use client";

import { defaultAudio } from "@/lib/share-links";
import type { ShareOption, ShareOptionAudio } from "@workspace/api/api";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Row,
  RowMain,
  RowMeta,
  Rows,
  RowTitle,
} from "@workspace/ui/components/layout/rows";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";

/** The file as its owner knows it. A version number is the fallback, not the
 *  label: nobody remembers which take was v2, but they remember what they
 *  called the file. */
const audioLabel = (audio: ShareOptionAudio) =>
  audio.fileName ?? `Version ${audio.version}`;

const versionLabel = (audio: ShareOptionAudio) =>
  audio.isPrimary ? `v${audio.version} · primary` : `v${audio.version}`;

/**
 * Which version of each track a snapshot freezes, and — for a collection —
 * what each one is called once frozen. Any version qualifies, not just the
 * primary: naming a specific one is the reason a snapshot exists.
 */
export function ShareVersionPicker({
  options,
  chosen,
  onChange,
  titles,
  onTitleChange,
}: {
  options: ShareOption[];
  chosen: Record<number, number>;
  onChange: (trackId: number, trackAudioId: number) => void;
  /** Per-track names, for a collection. A track share is named by the share's
   *  own title, so it has nothing to set here. */
  titles?: Record<number, string>;
  onTitleChange: (trackId: number, title: string) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <Label>
        {titles ? "Tracks and versions to freeze" : "Version to freeze"}
      </Label>
      <Rows className="max-h-56 overflow-y-auto">
        {options.map((track) => {
          const selectedId = chosen[track.id] ?? defaultAudio(track)?.id;
          const selected = track.audios.find(
            (audio) => audio.id === selectedId
          );

          return (
            <Row key={track.id} className="gap-2 px-0">
              <RowMain>
                {titles ? (
                  <Input
                    value={titles[track.id] ?? ""}
                    placeholder={track.title ?? "Untitled"}
                    aria-label={`Name shown for ${track.title ?? "this track"}`}
                    onChange={(e) => onTitleChange(track.id, e.target.value)}
                    className="h-8"
                  />
                ) : (
                  <RowTitle>{track.title ?? "Untitled"}</RowTitle>
                )}
                <RowMeta>
                  {track.audios.length === 1
                    ? "1 version"
                    : `${track.audios.length} versions`}
                </RowMeta>
              </RowMain>
              <Select
                value={selectedId == null ? "" : String(selectedId)}
                onValueChange={(value) => onChange(track.id, Number(value))}
              >
                <SelectTrigger
                  className="w-44 shrink-0"
                  aria-label={`Version of ${track.title ?? "this track"}`}
                >
                  <SelectValue>
                    <span className="block truncate">
                      {selected ? audioLabel(selected) : "Choose a version"}
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {track.audios.map((audio) => (
                    <SelectItem key={audio.id} value={String(audio.id)}>
                      <span className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="min-w-0 flex-1 truncate">
                          {audioLabel(audio)}
                        </span>
                        <span className="shrink-0 text-micro text-ink-soft">
                          {versionLabel(audio)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Row>
          );
        })}
      </Rows>
    </div>
  );
}
