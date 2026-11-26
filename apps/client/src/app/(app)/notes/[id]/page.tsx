import { NotebookNote } from "@/components/notebook/NotebookNote";
import { cachedNote } from "@/lib/server-data";
import { isActionError } from "@workspace/api/lib/action-result";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const note = await cachedNote(Number((await params).id));

  return { title: isActionError(note) ? "Note" : note.title || "Note" };
}

export default async function Page({ params }: Props) {
  const note = await cachedNote(Number((await params).id));

  if (isActionError(note)) {
    notFound();
  }

  return <NotebookNote note={note} />;
}
