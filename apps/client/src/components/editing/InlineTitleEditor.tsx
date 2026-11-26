"use client";

import { useEntityKey } from "@/components/commands/entity-surface";
import { InlineEditActions } from "@/components/editing/InlineEditActions";
import { mastheadTitle } from "@/components/masthead/Masthead";
import { type PatchableEntity } from "@/actions/patch-field";
import { useInlineEdit } from "@/hooks/use-inline-edit";
import { useProjectRole } from "@/hooks/use-project-role";
import { IconAlertCircle, IconPencil } from "@tabler/icons-react";
import { Input } from "@workspace/ui/components/input";
import { useArrival } from "@workspace/ui/components/motion/arrival";
import { AnimatePresence, m, OPTICAL, SPRING } from "@workspace/ui/lib/motion";
import { REVEAL_ON_HOVER } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import React from "react";

interface InlineTitleEditorProps {
  value: string;
  entityType: PatchableEntity;
  entityId: number;
  fieldName: string;
  placeholder?: string;
  actions?: React.ReactNode;
  /** Render the title at the compact size. */
  compact?: boolean;
}

/**
 * The masthead `<h1>` with inline editing. In display mode the heading holds a
 * button carrying the title, so the whole heading is one tab stop and the
 * pencil beside it is decoration rather than a second control. The title wraps
 * within the content column, so there is no marquee.
 *
 * Its root carries the masthead's title arrival, because this component owns
 * the element the heading swaps under; once the page has settled, opening and
 * closing the editor replays nothing.
 */
export default function InlineTitleEditor({
  value,
  entityType,
  entityId,
  fieldName,
  placeholder,
  actions,
  compact,
}: InlineTitleEditorProps) {
  const projectRole = useProjectRole();
  const canEdit = projectRole?.can("editor") ?? true;
  const edit = useInlineEdit({ entityType, entityId, fieldName, value });
  useEntityKey("rename", edit.begin, canEdit && !edit.isEditing);
  const editHintId = React.useId();

  const titleClass = mastheadTitle(!!compact);

  return (
    <m.div
      {...useArrival("title")}
      layout
      transition={SPRING.surface}
      className={"relative"}
    >
      <AnimatePresence mode={"popLayout"} initial={false}>
        {edit.isEditing ? (
          <m.div
            key={"edit"}
            variants={OPTICAL}
            initial={"hidden"}
            animate={"shown"}
            exit={"leaving"}
            data-saving={edit.isSaving || undefined}
            className={
              "motion-reveal data-saving:pointer-events-none data-saving:opacity-50"
            }
          >
            <div
              className={"mb-2 flex w-full max-w-[28rem] items-center gap-1"}
            >
              <Input
                type={"text"}
                value={edit.draft}
                onChange={(e) => edit.setDraft(e.target.value)}
                onKeyDown={edit.onKeyDown}
                placeholder={placeholder || "Enter title..."}
                aria-label={"Title"}
                aria-invalid={edit.error != null}
                className={
                  edit.error
                    ? "h-9 flex-1 border-danger bg-danger/20 text-lead"
                    : "h-9 flex-1 bg-paper/80 text-lead"
                }
                autoFocus
              />
              <InlineEditActions
                label={"title"}
                onConfirm={edit.submit}
                onCancel={edit.cancel}
                disabled={edit.isSaving}
              />
            </div>
            {edit.error && (
              <div
                role={"alert"}
                className={
                  "mt-1 flex items-center gap-1 text-small text-danger"
                }
              >
                <IconAlertCircle size={12} />
                <span>{edit.error}</span>
              </div>
            )}
          </m.div>
        ) : (
          <m.div
            key={"show"}
            variants={OPTICAL}
            initial={"hidden"}
            animate={"shown"}
            exit={"leaving"}
          >
            {canEdit ? (
              <h1 className={`group relative ${titleClass}`}>
                <button
                  type={"button"}
                  onClick={edit.begin}
                  aria-describedby={editHintId}
                  className={
                    "-mx-1 block rounded-md px-1 text-left motion-ink hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-none"
                  }
                >
                  {value}
                </button>
                <span id={editHintId} className={"sr-only"}>
                  Edit title
                </span>
                <IconPencil
                  size={16}
                  aria-hidden={"true"}
                  className={cn(
                    "pointer-events-none absolute top-2 right-0 z-20 text-ink-soft group-focus-within:text-ink group-hover:text-ink",
                    REVEAL_ON_HOVER
                  )}
                />
              </h1>
            ) : (
              <h1 className={titleClass}>{value}</h1>
            )}
            {actions && (
              <div className={"absolute top-0 right-0 z-10"}>{actions}</div>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </m.div>
  );
}
