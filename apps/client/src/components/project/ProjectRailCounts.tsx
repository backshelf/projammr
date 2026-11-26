import { MetadataItem } from "@workspace/ui/components/layout/metadata-item";
import {
  RailBlock,
  RailIdentity,
  RailLabel,
} from "@workspace/ui/components/layout/rail";
import { pluralizeCount } from "@workspace/session-diff/format";
import { ActionError, CollectionSummary } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";

export async function ProjectRailCounts({
  name,
  collectionsPromise,
}: {
  name: string;
  collectionsPromise: Promise<CollectionSummary[] | ActionError>;
}) {
  const collections = await collectionsPromise;

  if (isActionError(collections)) {
    return <RailIdentity title={name} />;
  }

  const trackCount = collections.reduce(
    (total, collection) => total + collection.trackCount,
    0
  );

  return (
    <>
      <RailIdentity
        title={name}
        subtitle={`${pluralizeCount(
          collections.length,
          "collection"
        )} · ${pluralizeCount(trackCount, "track")}`}
      />
      <RailBlock grid>
        <div>
          <RailLabel>COLLECTIONS</RailLabel>
          <MetadataItem>{collections.length}</MetadataItem>
        </div>
        <div>
          <RailLabel>TRACKS</RailLabel>
          <MetadataItem>{trackCount}</MetadataItem>
        </div>
      </RailBlock>
    </>
  );
}
