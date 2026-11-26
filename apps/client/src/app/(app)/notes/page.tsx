import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Notebook",
};

/**
 * The right pane with no note open. Only ever seen on a wide screen: below
 * `md:` the shell shows the list alone until a note is picked.
 */
export default function Page() {
  return (
    <div className={"hidden h-full items-center justify-center p-8 md:flex"}>
      <p className={"text-small text-ink-soft"}>Select a note or press New</p>
    </div>
  );
}
