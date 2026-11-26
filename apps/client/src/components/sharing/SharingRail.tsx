import { listSharelinks } from "@/actions/sharelinks";
import { ShareLinkRows } from "@/components/sharing/ShareLinkRows";
import type { NewShareRequest } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Arrive } from "@workspace/ui/components/layout/arrive";

/**
 * The contents of the rail's sharing block, on the track and collection pages
 * alike. The block itself is the page's, so its hairline seam is drawn
 * whether or not the links have arrived yet.
 */
export async function SharingRail({
  entityType,
  entityId,
}: {
  entityType: NewShareRequest["entityType"];
  entityId: number;
}) {
  const result = await listSharelinks(entityType, entityId);

  return (
    <Arrive>
      <ShareLinkRows
        entityType={entityType}
        entityId={entityId}
        links={isActionError(result) ? [] : result}
      />
    </Arrive>
  );
}
