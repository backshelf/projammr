import { NotebookNote } from "@/components/notebook/NotebookNote";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "New note",
};

/**
 * A blank editor bound to no row. Nothing is written until the user types:
 * the first change creates the note and rewrites the URL to it in place, so
 * leaving this route untouched leaves nothing behind.
 *
 * This is a sibling file route rather than an `[id]` value on purpose — Next
 * matches the static segment first, so `/notes/new` never reaches the note
 * page with an id of `NaN`.
 */
export default function Page() {
  return <NotebookNote draft={{}} />;
}
