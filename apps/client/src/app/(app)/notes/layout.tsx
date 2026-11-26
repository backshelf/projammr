import { TopStrip } from "@/components/dock/TopStrip";
import { NoteList } from "@/components/notebook/NoteList";
import { NotebookShell } from "@/components/notebook/NotebookShell";
import { cachedMyNotes } from "@/lib/server-data";
import { getCachedSession } from "@/lib/session";
import { LyricsProvider } from "@/components/editing/LyricsProvider";
import { isActionError } from "@workspace/api/lib/action-result";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

export default async function NotesLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCachedSession();

  if (session.kind === "signed-out") {
    redirect("/");
  }

  const notes = await cachedMyNotes();

  return (
    <LyricsProvider>
      <div className={"flex h-full min-h-0 flex-col"}>
        <Suspense
          fallback={<div className={"min-h-11 md:hidden"} aria-hidden />}
        >
          <TopStrip />
        </Suspense>
        <div className={"min-h-0 flex-1"}>
          <NotebookShell
            summaries={isActionError(notes) ? [] : notes}
            list={<NoteList />}
          >
            {children}
          </NotebookShell>
        </div>
      </div>
    </LyricsProvider>
  );
}
