"use client";

import { clientGetMyMachines } from "@/lib/client-api";
import { onInvalidated } from "@/lib/mutation";
import type { MachineList, NotABounce } from "@workspace/api/api";
import { Rows } from "@workspace/ui/components/layout/rows";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { DESKTOP_APP_DOWNLOAD_URL } from "@workspace/ui/lib/site";
import { useEffect, useState } from "react";
import { createMachinePoll } from "./machine-poll";
import { MachineRow } from "./MachineRow";
import { RejectionList } from "./RejectionList";

/** A "Not a bounce" file as a list entry: its name, else the fingerprint that names it to dit. */
const notABounceEntry = ({ id, fileName, fingerprint }: NotABounce) => ({
  id,
  label: fileName ?? fingerprint,
  title: fingerprint,
});

/**
 * The caller's machines as the server last said: the files they marked "Not
 * a bounce" (shared by every machine, so listed once, first), then one row per
 * machine, or how to get a first one. The list reads the server again every
 * 30 s while the page is in view, at once when it comes back into view, and
 * after every change made from here.
 *
 * `initial` is the server's read for the page, `null` where it failed (the
 * next read tries again).
 */
export function MachinesSection({ initial }: { initial: MachineList | null }) {
  const [list, setList] = useState(initial);
  // A fresh server read of the page (a route refresh) replaces what the
  // browser read since.
  const [seed, setSeed] = useState(initial);
  if (initial !== seed) {
    setSeed(initial);
    setList(initial);
  }

  useMachinePoll(setList);

  return (
    <section aria-label="Machines" className="flex flex-col">
      <SectionHead
        count={list && list.machines.length > 0 ? list.machines.length : null}
      >
        Machines
      </SectionHead>
      {list === null ? (
        <p role="status" className="text-small text-ink-soft">
          Couldn&apos;t read your machines. The page tries again every half a
          minute.
        </p>
      ) : (
        <>
          {list.notABounce.length > 0 && (
            <RejectionList
              heading="Not a bounce"
              items={list.notABounce.map(notABounceEntry)}
              className="mb-5"
            />
          )}
          {list.machines.length === 0 ? (
            <NoMachines />
          ) : (
            <Rows as="ul" className="border-b border-rule">
              {list.machines.map((machine) => (
                <MachineRow key={machine.id} machine={machine} />
              ))}
            </Rows>
          )}
        </>
      )}
    </section>
  );
}

/**
 * Keeps the list current while the section is mounted: the poll's reads while
 * the page is visible, and a read whenever a machine mutation says the list
 * changed.
 */
function useMachinePoll(onRead: (list: MachineList) => void) {
  useEffect(() => {
    const poll = createMachinePoll({
      read: clientGetMyMachines,
      onRead,
      // The poll clears every timer it sets in its own `stop()`, which this
      // effect's cleanup calls; the lint rule cannot see across that boundary.
      // eslint-disable-next-line @eslint-react/web-api-no-leaked-timeout
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (timer) => clearTimeout(timer),
    });
    const onVisibility = () =>
      poll.setVisible(document.visibilityState === "visible");
    onVisibility();
    poll.start();
    document.addEventListener("visibilitychange", onVisibility);
    const unsubscribe = onInvalidated("machines", poll.refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
      poll.stop();
    };
  }, [onRead]);
}

/** No machine yet: what one is, and where to get dit. */
function NoMachines() {
  return (
    <div className="flex flex-col items-start gap-2 border-t border-rule pt-5">
      <p className="text-body text-ink">No machines yet.</p>
      <p className="max-w-[54ch] text-small text-pretty text-ink-soft">
        Install dit on the Mac you make music on.
      </p>
      <a
        href={DESKTOP_APP_DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer"
        className="text-small text-art underline-offset-4 hover:underline focus-visible:underline"
      >
        Download dit for Mac
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}
