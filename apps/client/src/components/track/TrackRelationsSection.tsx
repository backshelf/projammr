"use client";

import { AppLink } from "@/components/navigation/AppLink";
import {
  inverseRelationVerb,
  RelationSelector,
  relationVerb,
} from "@/components/product-linking/RelationSelector";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { removeTrackRelation } from "@/entities/mutations";
import { useMutate } from "@/hooks/use-mutate";
import { useProject, useProjectRole } from "@/hooks/use-project-role";
import { hrefFromParsedRoute } from "@/lib/utils";
import { IconPlus, IconX } from "@tabler/icons-react";
import type { TrackRelationEdge } from "@workspace/api/api";
import { Button } from "@workspace/ui/components/button";
import { REVEAL_ON_HOVER } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  EmptySection,
  SectionAdd,
} from "@workspace/ui/components/layout/empty-section";
import { useState } from "react";
import { toast } from "sonner";
import { isActionError } from "@workspace/api/lib/action-result";

export function TrackRelationsSection({
  trackId,
  relations,
}: {
  trackId: number;
  relations: TrackRelationEdge[];
}) {
  const { id: projectId } = useProject();
  const mutate = useMutate();
  const mayEdit = useProjectRole()?.can?.("editor") ?? true;
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  async function remove(relationId: number) {
    setRemovingId(relationId);
    const result = await mutate(removeTrackRelation(trackId, relationId));
    setRemovingId(null);
    if (isActionError(result)) {
      toast.error(`Failed to remove relation: ${result.error}`);
      return;
    }
  }

  return (
    <>
      <EmptySection
        label={"RELATIONS"}
        empty={relations.length === 0}
        addControl={
          mayEdit ? (
            <SectionAdd onClick={() => setAdding(true)}>Relation</SectionAdd>
          ) : undefined
        }
      >
        <section>
          <SectionHead
            count={relations.length || undefined}
            action={
              mayEdit ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-fit"
                  aria-label="Add a relation"
                  onClick={() => setAdding(true)}
                >
                  <IconPlus />
                </Button>
              ) : undefined
            }
          >
            RELATIONS
          </SectionHead>
          {relations.map((edge) => (
            <div
              key={edge.id}
              className="group flex items-center gap-3 border-t border-rule py-2 first-of-type:border-t-0"
            >
              <span className="w-28 shrink-0 font-sub text-micro tracking-[0.08em] text-ink-soft uppercase">
                {edge.direction === "from"
                  ? relationVerb(edge.relationType.name)
                  : inverseRelationVerb(edge.relationType.name)}
              </span>
              <AppLink
                href={hrefFromParsedRoute(
                  { kind: "track", trackId: edge.otherTrack.id },
                  projectId
                )}
                className="min-w-0 truncate text-small text-ink underline-offset-2 hover:underline"
              >
                {edge.otherTrack.title}
              </AppLink>
              {mayEdit && (
                <button
                  type="button"
                  disabled={removingId === edge.id}
                  onClick={() => remove(edge.id)}
                  aria-label="Remove relation"
                  className={cn(
                    "ml-auto text-ink-soft hover:text-danger disabled:opacity-50",
                    REVEAL_ON_HOVER
                  )}
                >
                  <IconX size={14} />
                </button>
              )}
            </div>
          ))}
        </section>
      </EmptySection>
      {mayEdit && (
        <Dialog open={adding} onOpenChange={setAdding}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add a relation</DialogTitle>
            </DialogHeader>
            <RelationSelector trackId={trackId} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
