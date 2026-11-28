import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import {
  RailBlock,
  RailIdentity,
  RailLabel,
} from "@workspace/ui/components/layout/rail";
import { pluralizeCount } from "@workspace/session-diff/format";
import { ActionError, CollectionSummary, TracksPage } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";

export async function ProjectRailCounts({
  name,
  collectionsPromise,
  trackCountPromise,
}: {
  name: string;
  collectionsPromise: Promise<CollectionSummary[] | ActionError>;
  trackCountPromise: Promise<TracksPage | ActionError>;
}) {
  const [collections, tracksPage] = await Promise.all([
    collectionsPromise,
    trackCountPromise,
  ]);

  if (isActionError(collections) && isActionError(tracksPage)) {
    return <RailIdentity title={name} />;
  }

  const collectionCount = isActionError(collections) ? 0 : collections.length;
  const trackCount = isActionError(tracksPage) ? 0 : tracksPage.rowCount;

  return (
    <>
      <RailIdentity
        title={name}
        subtitle={`${pluralizeCount(
          collectionCount,
          "collection"
        )} · ${pluralizeCount(trackCount, "track")}`}
      />
      <RailBlock grid>
        <div>
          <RailLabel>COLLECTIONS</RailLabel>
          <MetadataItem>{collectionCount}</MetadataItem>
        </div>
        <div>
          <RailLabel>TRACKS</RailLabel>
          <MetadataItem>{trackCount}</MetadataItem>
        </div>
      </RailBlock>
    </>
  );
}
