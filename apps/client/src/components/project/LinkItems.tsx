"use client";

import { patchField } from "@/actions/patch-field";
import { AppLink } from "@/components/navigation/AppLink";
import { LinkFormDialog } from "@/components/project/LinkFormDialog";
import { linkKeys, removeLinkAt } from "@/lib/links";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { Link as LinkType } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import { Button } from "@workspace/ui/components/button";
import {
  Row,
  RowMain,
  RowMeta,
  Rows,
  RowTitle,
} from "@workspace/ui/components/layout/rows";
import { REVEAL_ON_HOVER } from "@workspace/ui/lib/shell";
import { useState } from "react";
import { toast } from "sonner";

interface LinkItemsProps {
  links: LinkType[];
  projectId: number;
  canEdit: boolean;
}

/** Strips the scheme and any trailing slash so the host reads as the label. */
function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

const anchorProps = { target: "_blank", rel: "noreferrer" } as const;

function LinkLabel({ link }: { link: LinkType }) {
  return (
    <RowMain>
      <RowTitle>{link.name}</RowTitle>
      <RowMeta>{displayUrl(link.url)}</RowMeta>
    </RowMain>
  );
}

/**
 * An editor's row. The anchor and the two buttons are siblings, since a
 * button inside an anchor is invalid; the anchor takes the row's padding so
 * the whole row still opens the link.
 */
function EditableLinkRow({
  links,
  index,
  projectId,
}: {
  links: LinkType[];
  index: number;
  projectId: number;
}) {
  const [removing, setRemoving] = useState(false);
  const link = links[index];
  if (!link) return null;

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const result = await patchField(
        "project",
        projectId,
        "links",
        removeLinkAt(links, index)
      );
      if (isActionError(result)) toast.error(result.error);
    } catch {
      toast.error("Failed to remove link");
    } finally {
      // Reset on success too: when two links share a URL, the survivor
      // inherits this row's key, and with it this state.
      setRemoving(false);
    }
  };

  return (
    <Row className="group">
      <AppLink
        href={link.url}
        {...anchorProps}
        className="-my-2.5 flex min-w-0 flex-1 items-center self-stretch py-2.5"
      >
        <LinkLabel link={link} />
      </AppLink>
      <LinkFormDialog
        projectId={projectId}
        links={links}
        edit={{ index, link }}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          className={REVEAL_ON_HOVER}
          aria-label={`Edit ${link.name}`}
        >
          <IconPencil size={16} aria-hidden />
        </Button>
      </LinkFormDialog>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={handleRemove}
        disabled={removing}
        className={REVEAL_ON_HOVER}
        aria-label={`Remove ${link.name}`}
      >
        <IconTrash size={16} aria-hidden />
      </Button>
    </Row>
  );
}

export default function LinkItems({
  links,
  projectId,
  canEdit,
}: LinkItemsProps) {
  const keys = linkKeys(links);
  return (
    <Rows>
      {links.map((link, index) =>
        canEdit ? (
          <EditableLinkRow
            key={keys[index]}
            links={links}
            index={index}
            projectId={projectId}
          />
        ) : (
          <Row as={AppLink} key={keys[index]} href={link.url} {...anchorProps}>
            <LinkLabel link={link} />
          </Row>
        )
      )}
    </Rows>
  );
}
