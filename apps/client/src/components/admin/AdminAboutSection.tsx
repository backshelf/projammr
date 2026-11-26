"use client";

import { updateAvailability } from "@/components/admin/update-availability";
import {
  Row,
  RowMain,
  RowMeta,
  RowTitle,
  Rows,
} from "@workspace/ui/components/layout/rows";
import { SITE } from "@workspace/ui/lib/site";
import { useEffect, useState } from "react";

const LATEST_RELEASE_URL =
  "https://api.github.com/repos/backshelf/projammr/releases/latest";

/** Fetched in the browser, not on the server: an instance behind a firewall
 *  can still show its own version even when it cannot reach GitHub, and the
 *  request only ever fires for an admin looking at this pane. */
function useLatestReleaseTag(enabled: boolean): string | null {
  const [tag, setTag] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();

    fetch(LATEST_RELEASE_URL, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { tag_name?: string } | null) => {
        if (data?.tag_name) setTag(data.tag_name);
      })
      .catch(() => {
        // No network, rate-limited, aborted, or GitHub is down — the pane
        // just shows the running version with nothing to compare it to.
      });

    return () => controller.abort();
  }, [enabled]);

  return tag;
}

export function AdminAboutSection({
  version,
  updateCheck,
}: {
  version: string;
  updateCheck: boolean;
}) {
  const latestTag = useLatestReleaseTag(updateCheck);
  const availability = updateAvailability(updateCheck, version, latestTag);

  return (
    <section>
      <Rows>
        <Row>
          <RowMain>
            <RowTitle>Version</RowTitle>
            <RowMeta>Running on this instance</RowMeta>
          </RowMain>
          <span className="shrink-0 text-small text-ink-soft tabular-nums">
            {version}
          </span>
        </Row>
        {availability.checked && (
          <Row>
            <RowMain>
              <RowTitle>
                {availability.available
                  ? `${availability.latest} available`
                  : "Up to date"}
              </RowTitle>
              {availability.available && (
                <RowMeta>
                  <a
                    href={`${SITE.repository}/releases/tag/${availability.latest}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline underline-offset-3 hover:text-ink"
                  >
                    Read the changelog
                  </a>
                </RowMeta>
              )}
            </RowMain>
          </Row>
        )}
      </Rows>
    </section>
  );
}
