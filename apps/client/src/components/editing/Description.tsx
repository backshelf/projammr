"use client";

import { saveRichText } from "@/actions/save-description";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import { REVEAL_FOCUS } from "@workspace/ui/lib/reveal-focus";
import { useProjectRole } from "@/hooks/use-project-role";
import {
  BlockEditorProps,
  EditorVariant,
} from "@workspace/ui/components/block-editor";
import dynamic from "next/dynamic";
import { useTheme } from "@/components/theme/AppThemeProvider";
import {
  ComponentType,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";

const BlockNoteEditor: ComponentType<BlockEditorProps> = dynamic(
  () =>
    import("@workspace/ui/components/block-editor").then(
      (next) => next.BlockEditor
    ),
  { ssr: false }
);

interface DescriptionProps {
  text: string;
  entityType: "project" | "collection" | "track" | "session";
  entityId: number;
  fieldName?: string;
  label?: string;
  placeholder?: string;
  variant?: EditorVariant;
}

export default function Description({
  text,
  entityType,
  entityId,
  fieldName = "notes",
  label,
  placeholder,
  variant = "document",
}: DescriptionProps) {
  // The document lives in a ref, not state: nothing here renders it — the
  // editor owns its own document from the moment it mounts and never re-reads
  // `value` — so holding it in state would re-render the whole editor on
  // every keystroke to display the same thing. The debounced save reads the
  // ref, which is also what it needs: it fires long after the keystroke that
  // scheduled it.
  const contentRef = useRef(text);
  const hasUnsavedEditsRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { resolvedTheme } = useTheme();
  const projectRole = useProjectRole();
  const canEdit = projectRole?.can("editor") ?? true;

  const doSave = useCallback(async () => {
    hasUnsavedEditsRef.current = false;
    await saveRichText(entityType, entityId, fieldName, contentRef.current);
  }, [entityType, entityId, fieldName, contentRef]);

  const handleChange = useCallback(
    (json: string) => {
      contentRef.current = json;
      hasUnsavedEditsRef.current = true;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(doSave, 1500);
    },
    [doSave]
  );

  // Bound once, on mount: re-running this effect would fire its cleanup — and
  // so an unwanted save — every time `doSave`'s identity changed. The cleanup
  // calls the latest `doSave` through an effect event instead.
  const saveUnsavedEdits = useEffectEvent(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // Not awaited: navigating away unmounts this, and blocking the
    // navigation on the round trip would be visible as a stall.
    if (hasUnsavedEditsRef.current) doSave();
  });
  useEffect(() => () => saveUnsavedEdits(), []);

  return (
    <div className={"flex h-full w-full max-w-full flex-col"}>
      {label && <SectionHead>{label}</SectionHead>}
      {/* No explicit width: `.doc-surface` bleeds into the gutter with a
          negative inline margin, and a 100% width would pin its right edge and
          shift the whole box left instead of widening it. */}
      <div
        className={"doc doc-surface min-h-40 flex-1"}
        data-variant={variant}
        {...REVEAL_FOCUS}
      >
        <BlockNoteEditor
          variant={variant}
          value={text}
          onChange={handleChange}
          editable={canEdit}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          placeholder={placeholder || (canEdit ? "Write something…" : " ")}
        />
      </div>
    </div>
  );
}
