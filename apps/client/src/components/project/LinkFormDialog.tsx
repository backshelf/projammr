"use client";

import { patchField } from "@/actions/patch-field";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useCallback, useState } from "react";
import { isActionError } from "@workspace/api/lib/action-result";
import type { Link } from "@workspace/api/api";
import { normaliseUrl, replaceLinkAt } from "@/lib/links";

interface LinkFormDialogProps {
  projectId: number;
  links: Link[];
  /** The link this dialog edits, by its place in `links`; without it the dialog adds one. */
  edit?: { index: number; link: Link };
  children?: React.ReactNode;
}

export function LinkFormDialog({
  projectId,
  links,
  edit,
  children,
}: LinkFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(edit?.link.name ?? "");
  const [url, setUrl] = useState(edit?.link.url ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setName(edit?.link.name ?? "");
    setUrl(edit?.link.url ?? "");
    setError(null);
  }, [edit]);

  const handleSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!name.trim() || !url.trim()) return;

      const link = { name: name.trim(), url: normaliseUrl(url) };

      setSaving(true);
      try {
        const newLinks = edit
          ? replaceLinkAt(links, edit.index, link)
          : [...links, link];
        const result = await patchField(
          "project",
          projectId,
          "links",
          newLinks
        );
        if (isActionError(result)) {
          setError(result.error);
        } else {
          setOpen(false);
        }
      } catch {
        setError("Failed to save link");
      } finally {
        setSaving(false);
      }
    },
    [name, url, links, edit, projectId]
  );

  const submitLabel = edit
    ? { idle: "Save", busy: "Saving…" }
    : { idle: "Add", busy: "Adding…" };

  const handleOpenChange = (isOpen: boolean) => {
    resetForm();
    setOpen(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="bg-paper">
        <form onSubmit={handleSave}>
          <DialogTitle>{edit ? "Edit link" : "Add Link"}</DialogTitle>
          <div className="mt-3 flex flex-col gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="link-name">Name</Label>
              <Input
                id="link-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Spotify, Bandcamp"
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>
          {error && <p className="mt-2 text-small text-danger">{error}</p>}
          <DialogFooter showCloseButton className="mt-4">
            <Button
              type="submit"
              disabled={saving || !name.trim() || !url.trim()}
            >
              {saving ? submitLabel.busy : submitLabel.idle}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
