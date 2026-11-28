"use client";

import { AppLink } from "@/components/navigation/AppLink";
import { NEW_NOTE_HREF, noteHref } from "@/lib/utils";
import { IconNotebook } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Desktop notebook index: opens the latest note automatically when one
 * exists, or offers a quick-compose empty prompt. Hidden below `md:` where
 * `NotebookShell` keeps the note list on screen until a note is chosen.
 */
export function DesktopNoteIndex({
  latestNoteId,
}: {
  latestNoteId: number | null;
}) {
  const isMobile = useIsMobile();
  const router = useRouter();

  useEffect(() => {
    if (latestNoteId === null || isMobile) return;
    router.replace(noteHref(latestNoteId));
  }, [isMobile, latestNoteId, router]);

  if (latestNoteId !== null) {
    return (
      <div className={"hidden h-full items-center justify-center p-8 md:flex"}>
        <p className={"text-small text-ink-soft"}>Opening latest note…</p>
      </div>
    );
  }

  return (
    <div className={"hidden h-full items-center justify-center p-8 md:flex"}>
      <Empty className={"max-w-sm"}>
        <EmptyHeader>
          <EmptyMedia variant={"icon"}>
            <IconNotebook />
          </EmptyMedia>
          <EmptyTitle>Start a note</EmptyTitle>
          <EmptyDescription>
            Jot down lyrics, arrangement ideas, or mix notes — link them to a
            track anytime.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <AppLink href={NEW_NOTE_HREF}>New note</AppLink>
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}
