"use client";

import { jobsAnnouncement } from "@/components/jobs/job-row";
import type { Job } from "@workspace/api/api";
import { useState } from "react";

/**
 * The queue's one live region. Both trays (the sidebar's and the phone strip's)
 * are mounted at once, so the announcement lives with the map they share
 * rather than in either of them, and a job finishing is heard once.
 */
export function JobsAnnouncer({
  jobsById,
}: {
  jobsById: ReadonlyMap<number, Job>;
}) {
  const [seen, setSeen] = useState(jobsById);
  const [message, setMessage] = useState("");

  if (seen !== jobsById) {
    setSeen(jobsById);
    const next = jobsAnnouncement(seen, jobsById);
    if (next !== null) setMessage(next);
  }

  return (
    <span role="status" className="sr-only">
      {message}
    </span>
  );
}
