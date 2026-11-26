"use client";

import {
  createSharelink,
  getShareOptions,
  updateSharelink,
  updateSharelinkTracks,
} from "@/actions/sharelinks";
import { useSetting } from "@/lib/settings/provider";
import type { ShareCommentPrivacy } from "@workspace/settings/groups/project-sharing";
import { ShareVersionPicker } from "@/components/sharing/ShareVersionPicker";
import {
  defaultAudio,
  fromDateInputValue,
  NEVER_EXPIRES,
  neverExpires,
  SHARE_TYPE_DESCRIPTIONS,
  toDateInputValue,
} from "@/lib/share-links";
import type {
  ActionError,
  NewShareRequest,
  ShareOption,
  Sharelink,
} from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Switch } from "@workspace/ui/components/switch";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { LABEL } from "@workspace/ui/lib/shell";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

type ShareType = Sharelink["shareType"];

type Draft = {
  shareType: ShareType;
  title: string;
  description: string;
  expires: boolean;
  expiresOn: string;
  privateComments: boolean;
  downloadsEnabled: boolean;
  /** The chosen version of each track, keyed by track id. Snapshots only. */
  versions: Record<number, number>;
  /** What each track is called once frozen, keyed by track id. */
  titles: Record<number, string>;
};

/** What a new link starts from: the project's sharing settings. */
type ShareDefaults = {
  kind: ShareType;
  expiresDays: number | null;
  commentPrivacy: ShareCommentPrivacy;
  downloads: boolean;
};

/** The day a date field offers when the project's links never expire by default. */
const FALLBACK_EXPIRY_DAYS = 30;

function expiryIn(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toDateInputValue(date.toISOString());
}

function draftFrom(
  link: Sharelink | undefined,
  defaults: ShareDefaults
): Draft {
  if (!link) {
    return {
      shareType: defaults.kind,
      title: "",
      description: "",
      expires: defaults.expiresDays !== null,
      expiresOn: expiryIn(defaults.expiresDays ?? FALLBACK_EXPIRY_DAYS),
      privateComments: defaults.commentPrivacy === "private",
      downloadsEnabled: defaults.downloads,
      versions: {},
      titles: {},
    };
  }

  const expires = !neverExpires(link.expiresAt);
  return {
    shareType: link.shareType,
    title: link.title ?? "",
    description: link.description ?? "",
    expires,
    expiresOn: expires
      ? toDateInputValue(link.expiresAt)
      : expiryIn(defaults.expiresDays ?? FALLBACK_EXPIRY_DAYS),
    privateComments: link.isCommentsPrivate,
    downloadsEnabled: link.isDownloadsEnabled,
    versions: Object.fromEntries(
      link.tracks
        .map((track) => [track.trackAudio.trackId, track.trackAudio.id])
        .filter(([trackId, audioId]) => trackId != null && audioId != null)
    ),
    titles: Object.fromEntries(
      link.tracks
        .map((track) => [track.trackAudio.trackId, track.title ?? ""])
        .filter(([trackId]) => trackId != null)
    ),
  };
}

type SnapshotOverrides = NonNullable<NewShareRequest["snapshotOverrides"]>;

/**
 * The versions a snapshot commits, in the entity's own running order, each
 * under the name a guest should see. A track share sets no per-track name:
 * the share's own title is what its single track is called.
 */
function chosenVersions(
  draft: Draft,
  options: ShareOption[],
  entityType: NewShareRequest["entityType"]
): SnapshotOverrides["trackAudios"] {
  return options.flatMap((track) => {
    const id = draft.versions[track.id] ?? defaultAudio(track)?.id;
    if (id == null) return [];
    const title =
      entityType === "collection" ? draft.titles[track.id]?.trim() : "";
    return [{ id, ...(title && { title }) }];
  });
}

const expiresAtFrom = (draft: Draft) =>
  draft.expires ? fromDateInputValue(draft.expiresOn) : NEVER_EXPIRES;

/**
 * Creates a share link, or edits one that exists. The two differ only in what
 * they commit, so the fields, the copy and the version picker are written once.
 */
export function ShareDialog({
  entityType,
  entityId,
  link,
  open,
  onOpenChange,
}: {
  entityType: NewShareRequest["entityType"];
  entityId: number;
  link?: Sharelink;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const defaults: ShareDefaults = {
    kind: useSetting("project-sharing.shareKind"),
    expiresDays: useSetting("project-sharing.shareExpiresDays"),
    commentPrivacy: useSetting("project-sharing.shareCommentPrivacy"),
    downloads: useSetting("project-sharing.shareDownloads"),
  };
  const [draft, setDraft] = useState<Draft>(() => draftFrom(link, defaults));
  const [options, setOptions] = useState<ShareOption[]>([]);
  const [saving, setSaving] = useState(false);

  const patch = useCallback(
    (fields: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...fields })),
    []
  );

  // Opening the dialog, or handing it a different link while open, starts the
  // draft over from that link. Reset during render so the stale draft never
  // paints.
  const [draftSource, setDraftSource] = useState({ open, link });
  if (draftSource.open !== open || draftSource.link !== link) {
    setDraftSource({ open, link });
    if (open) setDraft(draftFrom(link, defaults));
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void getShareOptions(entityType, entityId).then((result) => {
      if (cancelled) return;
      setOptions(isActionError(result) ? [] : result);
    });

    return () => {
      cancelled = true;
    };
  }, [open, entityType, entityId]);

  const commit = async (): Promise<Sharelink | ActionError> => {
    const snapshotOverrides =
      draft.shareType === "snapshot"
        ? {
            title: draft.title.trim(),
            trackAudios: chosenVersions(draft, options, entityType),
          }
        : undefined;

    if (!link) {
      return createSharelink(draft.shareType, {
        entityType,
        entityId,
        expiresAt: expiresAtFrom(draft),
        description: draft.description.trim() || undefined,
        privateComments: draft.privateComments,
        downloadsEnabled: draft.downloadsEnabled,
        snapshotOverrides,
      });
    }

    const updated = await updateSharelink(link.token, {
      description: draft.description.trim() || null,
      expiresAt: expiresAtFrom(draft),
      privateComments: draft.privateComments,
      downloadsEnabled: draft.downloadsEnabled,
    });

    if (isActionError(updated) || !snapshotOverrides) return updated;

    return updateSharelinkTracks(link.token, snapshotOverrides);
  };

  const save = async () => {
    if (draft.shareType === "snapshot" && options.length === 0) {
      toast.error("This has no audio to freeze into a snapshot yet");
      return;
    }

    setSaving(true);
    const result = await commit();
    setSaving(false);

    if (isActionError(result)) {
      toast.error(result.error);
      return;
    }

    toast.success(link ? "Share link updated" : "Share link created");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col bg-paper sm:max-w-lg">
        <DialogTitle>{link ? "Edit share link" : "Share"}</DialogTitle>
        <DialogDescription>
          Anyone holding the link can play this {entityType} without an account.
        </DialogDescription>

        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-1">
          {!link && (
            <fieldset className="flex flex-col gap-2">
              <legend className={cn(LABEL, "mb-1.5 text-ink-soft")}>
                WHAT THE LINK PLAYS
              </legend>
              {(["connected", "snapshot"] as const).map((shareType) => (
                <label
                  key={shareType}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border p-3 motion-ink",
                    draft.shareType === shareType
                      ? "border-ink bg-ink/4"
                      : "border-rule hover:bg-ink/4"
                  )}
                >
                  <input
                    type="radio"
                    name="shareType"
                    className="mt-1 accent-[var(--ink)]"
                    checked={draft.shareType === shareType}
                    onChange={() => patch({ shareType })}
                  />
                  <span className="min-w-0">
                    <span className="block text-body text-ink">
                      {shareType === "connected"
                        ? "Current version"
                        : "Snapshot"}
                    </span>
                    <span className="block text-micro text-ink-soft">
                      {SHARE_TYPE_DESCRIPTIONS[shareType]}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}

          {draft.shareType === "snapshot" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="share-title">Title guests see</Label>
                <Input
                  id="share-title"
                  value={draft.title}
                  placeholder="Leave blank to use the current title"
                  onChange={(e) => patch({ title: e.target.value })}
                />
              </div>
              <ShareVersionPicker
                options={options}
                chosen={draft.versions}
                onChange={(trackId, audioId) =>
                  patch({ versions: { ...draft.versions, [trackId]: audioId } })
                }
                titles={entityType === "collection" ? draft.titles : undefined}
                onTitleChange={(trackId, title) =>
                  patch({ titles: { ...draft.titles, [trackId]: title } })
                }
              />
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="share-description">Note for whoever opens it</Label>
            <Textarea
              id="share-description"
              rows={2}
              value={draft.description}
              placeholder="What you want them to listen for"
              onChange={(e) => patch({ description: e.target.value })}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="share-expires">Stops working</Label>
            <div className="flex items-center gap-3">
              <Switch
                id="share-expires"
                checked={draft.expires}
                onCheckedChange={(expires) => patch({ expires })}
              />
              <span className="text-small text-ink-soft">
                {draft.expires ? "On" : "Never"}
              </span>
              {draft.expires && (
                <Input
                  type="date"
                  aria-label="Expiry date"
                  className="w-auto"
                  value={draft.expiresOn}
                  onChange={(e) => patch({ expiresOn: e.target.value })}
                />
              )}
            </div>
          </div>

          <ShareToggle
            id="share-private-comments"
            label="Keep guest comments private"
            hint="Each guest sees only the comments they wrote, and the replies to them."
            checked={draft.privateComments}
            onCheckedChange={(privateComments) => patch({ privateComments })}
          />
          <ShareToggle
            id="share-downloads"
            label="Allow downloads"
            hint="Adds a download control beside each track on the share page."
            checked={draft.downloadsEnabled}
            onCheckedChange={(downloadsEnabled) => patch({ downloadsEnabled })}
          />
        </div>

        <DialogFooter showCloseButton>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : link ? "Save changes" : "Create link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ShareToggle({
  id,
  label,
  hint,
  checked,
  onCheckedChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <span className="mt-0.5 block text-micro text-ink-soft">{hint}</span>
      </span>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
