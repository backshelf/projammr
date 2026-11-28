"use client";

import { saveRichText } from "@/actions/save-description";
import { useTheme } from "@/components/theme/AppThemeProvider";
import { useProjectRole } from "@/hooks/use-project-role";
import { IconCheck } from "@tabler/icons-react";
import { isActionError } from "@workspace/api/lib/action-result";
import type {
  BlockEditorProps,
  EditorVariant,
} from "@workspace/ui/components/block-editor";
import { useSectionRevealed } from "@workspace/ui/components/layout/empty-section";
import { SectionHead } from "@workspace/ui/components/layout/section-head";
import {
  isBlankDocument,
  parseInitialValue,
} from "@workspace/ui/lib/block-document";
import { keyedByContent } from "@workspace/ui/lib/keyed";
import { REVEAL_FOCUS } from "@workspace/ui/lib/reveal-focus";
import { cn } from "@workspace/ui/lib/utils";
import dynamic from "next/dynamic";
import {
  type ComponentType,
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

const BlockNoteEditor: ComponentType<BlockEditorProps> = dynamic(
  () =>
    import("@workspace/ui/components/block-editor").then(
      (next) => next.BlockEditor
    ),
  { ssr: false }
);

type StoredBlock = ReturnType<typeof parseInitialValue>[number];
type SaveStatus = "idle" | "saving" | "saved" | "error";

const SAFE_HREF = /^(https?:|mailto:|\/|#)/i;

function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const trimmed = href.trim();
  return SAFE_HREF.test(trimmed) ? trimmed : null;
}

function inlineKeyOf(item: unknown): string {
  if (typeof item === "string") return `s:${item}`;
  if (!item || typeof item !== "object") return "null";
  const node = item as { type?: string; text?: string; href?: string };
  return `${node.type ?? "text"}:${node.href ?? node.text ?? ""}`;
}

function blockKeyOf(block: StoredBlock): string {
  const b = block as { id?: string; type?: string };
  return b.id ? `id:${b.id}` : `${b.type ?? "block"}:${JSON.stringify(block)}`;
}

function renderInline(content: unknown): ReactNode {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  return keyedByContent(content, inlineKeyOf).map(({ key, item }) => {
    if (typeof item === "string") return <Fragment key={key}>{item}</Fragment>;
    if (!item || typeof item !== "object") return null;
    const node = item as {
      type?: string;
      text?: string;
      href?: string;
      content?: unknown;
      styles?: {
        bold?: boolean;
        italic?: boolean;
        underline?: boolean;
        strike?: boolean;
        code?: boolean;
      };
    };

    if (node.type === "link") {
      const href = safeHref(node.href);
      const inner = renderInline(node.content);
      return href ? (
        <a key={key} href={href} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      ) : (
        <Fragment key={key}>{inner}</Fragment>
      );
    }

    let el: ReactNode = node.text ?? "";
    const styles = node.styles;
    if (styles?.code) el = <code>{el}</code>;
    if (styles?.bold) el = <strong>{el}</strong>;
    if (styles?.italic) el = <em>{el}</em>;
    if (styles?.underline) el = <u>{el}</u>;
    if (styles?.strike) el = <s>{el}</s>;
    return <Fragment key={key}>{el}</Fragment>;
  });
}

function renderBlockContent(block: StoredBlock): ReactNode {
  const b = block as {
    type?: string;
    props?: { level?: number; checked?: boolean };
    content?: unknown;
    children?: StoredBlock[];
  };
  const inline = renderInline(b.content);
  const nested =
    Array.isArray(b.children) && b.children.length > 0 ? (
      <div className="pl-5">
        <ReadOnlyBlocks blocks={b.children} />
      </div>
    ) : null;

  switch (b.type) {
    case "heading": {
      const level = b.props?.level;
      if (level === 1)
        return (
          <>
            <h1>{inline}</h1>
            {nested}
          </>
        );
      if (level === 2)
        return (
          <>
            <h2>{inline}</h2>
            {nested}
          </>
        );
      if (level === 3)
        return (
          <>
            <h3>{inline}</h3>
            {nested}
          </>
        );
      return (
        <>
          <h4>{inline}</h4>
          {nested}
        </>
      );
    }
    case "section":
      return (
        <>
          <div data-content-type="section">{inline}</div>
          {nested}
        </>
      );
    case "quote":
      return (
        <>
          <blockquote>{inline}</blockquote>
          {nested}
        </>
      );
    case "codeBlock":
      return (
        <>
          <pre className="my-2 overflow-x-auto rounded-sm bg-paper-sunk p-3">
            <code>{inline}</code>
          </pre>
          {nested}
        </>
      );
    case "checkListItem": {
      const checked = Boolean(b.props?.checked);
      return (
        <div className="my-1">
          <div className="flex items-baseline gap-2">
            <span
              aria-hidden
              className={cn(
                "inline-grid size-3.5 shrink-0 translate-y-0.5 place-items-center rounded-sm border",
                checked
                  ? "border-art bg-art text-paper"
                  : "border-rule-strong bg-transparent"
              )}
            >
              {checked && <IconCheck className="size-2.5" stroke={3} />}
            </span>
            <span className={cn(checked && "line-through opacity-75")}>
              {inline}
            </span>
          </div>
          {nested}
        </div>
      );
    }
    case "bulletListItem":
    case "numberedListItem":
      return (
        <li>
          {inline}
          {nested}
        </li>
      );
    default:
      return (
        <>
          <p className="min-h-[1.25em]">{inline}</p>
          {nested}
        </>
      );
  }
}

type BlockSegment =
  | { kind: "single"; key: string; block: StoredBlock }
  | {
      kind: "list";
      key: string;
      listType: "bulletListItem" | "numberedListItem";
      items: { key: string; block: StoredBlock }[];
    };

function ReadOnlyBlocks({ blocks }: { blocks: readonly StoredBlock[] }) {
  const segments: BlockSegment[] = [];
  const keyed = keyedByContent(blocks, blockKeyOf);
  let i = 0;
  while (i < keyed.length) {
    const current = keyed[i]!;
    const type = (current.item as { type?: string }).type;
    if (type === "bulletListItem" || type === "numberedListItem") {
      const items: { key: string; block: StoredBlock }[] = [];
      while (
        i < keyed.length &&
        (keyed[i]!.item as { type?: string }).type === type
      ) {
        items.push({ key: keyed[i]!.key, block: keyed[i]!.item });
        i++;
      }
      segments.push({
        kind: "list",
        key: `list:${items[0]!.key}`,
        listType: type,
        items,
      });
      continue;
    }
    segments.push({ kind: "single", key: current.key, block: current.item });
    i++;
  }

  return (
    <>
      {segments.map((segment) => {
        if (segment.kind === "list") {
          const ListTag = segment.listType === "numberedListItem" ? "ol" : "ul";
          return (
            <ListTag
              key={segment.key}
              className={cn(
                "my-1 pl-5",
                segment.listType === "numberedListItem"
                  ? "list-decimal"
                  : "list-disc"
              )}
            >
              {segment.items.map(({ key, block }) => (
                <Fragment key={key}>{renderBlockContent(block)}</Fragment>
              ))}
            </ListTag>
          );
        }
        return (
          <Fragment key={segment.key}>
            {renderBlockContent(segment.block)}
          </Fragment>
        );
      })}
    </>
  );
}

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
  const mountedRef = useRef(true);

  const { resolvedTheme } = useTheme();
  const projectRole = useProjectRole();
  const canEdit = projectRole?.can("editor") ?? true;
  const revealed = useSectionRevealed();

  // Mount the rich BlockNote editor only on explicit edit intent (or when the
  // empty section was just opened from the add line), keeping viewers and
  // resting entity pages on lightweight static prose.
  const [editing, setEditing] = useState(() => canEdit && revealed);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const parsedBlocks = useMemo(() => parseInitialValue(text), [text]);
  const isEmpty = useMemo(() => isBlankDocument(parsedBlocks), [parsedBlocks]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (saveStatus !== "saved") return;
    const timer = setTimeout(() => {
      if (mountedRef.current) setSaveStatus("idle");
    }, 2500);
    return () => clearTimeout(timer);
  }, [saveStatus]);

  // Warn before unloading while edits have not yet been saved cleanly.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedEditsRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  const retryRef = useRef<() => void>(() => {});

  const doSave = useCallback(async () => {
    const payload = contentRef.current;
    if (mountedRef.current) {
      setSaveStatus("saving");
      setSaveError(null);
    }
    try {
      const result = await saveRichText(
        entityType,
        entityId,
        fieldName,
        payload
      );
      if (isActionError(result)) {
        hasUnsavedEditsRef.current = true;
        if (mountedRef.current) {
          setSaveStatus("error");
          setSaveError(result.error);
        }
        toast.error(result.error, {
          action: { label: "Retry", onClick: () => retryRef.current() },
        });
        return;
      }
      if (contentRef.current === payload) {
        hasUnsavedEditsRef.current = false;
      }
      if (mountedRef.current) {
        setSaveStatus(contentRef.current === payload ? "saved" : "saving");
        setSaveError(null);
      }
    } catch (error) {
      hasUnsavedEditsRef.current = true;
      const message =
        error instanceof Error ? error.message : "Failed to save changes";
      if (mountedRef.current) {
        setSaveStatus("error");
        setSaveError(message);
      }
      toast.error(message, {
        action: { label: "Retry", onClick: () => retryRef.current() },
      });
    }
  }, [entityType, entityId, fieldName, retryRef]);

  useEffect(() => {
    retryRef.current = () => {
      void doSave();
    };
  }, [doSave, retryRef]);

  const handleChange = useCallback(
    (json: string) => {
      contentRef.current = json;
      hasUnsavedEditsRef.current = true;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void doSave();
      }, 1500);
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
    if (hasUnsavedEditsRef.current) void doSave();
  });
  useEffect(() => () => saveUnsavedEdits(), []);

  const enterEdit = useCallback(() => {
    if (canEdit) setEditing(true);
  }, [canEdit]);

  const statusIndicator =
    saveStatus === "idle" ? null : (
      <span
        role="status"
        aria-live="polite"
        className="inline-flex items-center gap-2 text-micro tabular-nums"
      >
        {saveStatus === "saving" && (
          <span className="text-ink-soft">Saving…</span>
        )}
        {saveStatus === "saved" && <span className="text-ink-soft">Saved</span>}
        {saveStatus === "error" && (
          <>
            <span className="text-danger" title={saveError ?? undefined}>
              Error
            </span>
            <button
              type="button"
              onClick={() => void doSave()}
              className="cursor-pointer rounded-sm text-art underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-hidden"
            >
              Retry
            </button>
          </>
        )}
      </span>
    );

  const editButton =
    canEdit && !editing ? (
      <button
        type="button"
        onClick={enterEdit}
        className="cursor-pointer rounded-sm text-micro text-ink-soft transition-opacity hover:text-ink focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-hidden fine:opacity-0 fine:group-hover/doc:opacity-100 fine:focus-visible:opacity-100"
      >
        Edit
      </button>
    ) : null;

  const headerAction =
    statusIndicator || editButton ? (
      <span className="inline-flex items-center gap-3">
        {statusIndicator}
        {editButton}
      </span>
    ) : null;

  return (
    <div className={"group/doc flex h-full w-full max-w-full flex-col"}>
      {label ? (
        <SectionHead action={headerAction}>{label}</SectionHead>
      ) : (
        headerAction && (
          <div className="mb-1 flex justify-end">{headerAction}</div>
        )
      )}
      {/* No explicit width: `.doc-surface` bleeds into the gutter with a
          negative inline margin, and a 100% width would pin its right edge and
          shift the whole box left instead of widening it. */}
      <div
        className={cn(
          "doc flex-1",
          canEdit && "doc-surface",
          canEdit && !editing && "cursor-text"
        )}
        data-variant={variant}
        {...REVEAL_FOCUS}
        onClick={
          canEdit && !editing
            ? (event) => {
                if ((event.target as HTMLElement).closest("a, button")) return;
                enterEdit();
              }
            : undefined
        }
      >
        {editing && canEdit ? (
          <BlockNoteEditor
            variant={variant}
            value={text}
            onChange={handleChange}
            editable={canEdit}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            placeholder={placeholder || "Write something…"}
            ariaLabel={
              label || (fieldName === "notes" ? "Notes" : "Description")
            }
          />
        ) : isEmpty ? (
          canEdit ? (
            <button
              type="button"
              onClick={enterEdit}
              className="w-full cursor-text rounded-sm text-left text-body text-ink-faint italic focus-visible:ring-2 focus-visible:ring-art focus-visible:outline-hidden"
            >
              {placeholder || "Write something…"}
            </button>
          ) : null
        ) : (
          <ReadOnlyBlocks blocks={parsedBlocks} />
        )}
      </div>
    </div>
  );
}
