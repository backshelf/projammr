"use client";

import { patchField, type PatchableEntity } from "@/actions/patch-field";
import CopyButton from "@/components/CopyButton";
import { InlineEditActions } from "@/components/editing/InlineEditActions";
import { CheckboxDisplay } from "@/fields/checkbox";
import { UrlDisplay } from "@/fields/url";
import { RailLabel } from "@workspace/ui/components/layout/rail";
import { CLEAR, useInlineEdit } from "@/hooks/use-inline-edit";
import { useProjectRole } from "@/hooks/use-project-role";
import { IconPencil } from "@tabler/icons-react";
import { isActionError } from "@workspace/api/lib/action-result";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { ResponsivePicker } from "@workspace/ui/components/responsive-picker";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import { AnimatePresence, m, OPTICAL, SPRING } from "@workspace/ui/lib/motion";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { REVEAL_ON_HOVER } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

/** The kinds of value the editor enters: a custom field's types, each one. */
type InlinePropertyType =
  "text" | "number" | "date" | "select" | "checkbox" | "url";

interface InlinePropertyEditorProps {
  /** Section label displayed above the value */
  label: string;
  /** Current value to display */
  value: string | number | boolean | undefined;
  /** Kind of input shown when editing */
  type: InlinePropertyType;
  /** Entity type (e.g. "project", "track", "collection", "session") */
  entityType: PatchableEntity;
  /** Database ID of the entity */
  entityId: number;
  /** Field name in the API (e.g. "isrc", "notes", or a custom field's `cf_<id>`) */
  fieldName: string;
  /** For select type: the options, each saved as its value and read as its label */
  options?: { value: string; label: string }[];
  /** Whether saving an empty draft clears the value; a date's may by default,
   *  and a custom field's always may. */
  clearable?: boolean;
  /** Placeholder for the input field */
  placeholder?: string;
  /** Additional class names for the root container */
  className?: string;
  /** Show a copy-to-clipboard button and reveal the full value on hover */
  copyable?: boolean;
  /** What the value reads as when not being edited, where the stored form
   *  is not the readable one (an ISO date shown as "25 Sept 2026"). */
  displayValue?: string;
  /** A quiet line under the value that qualifies it ("Releases in 12 days").
   *  Sits inside the field so it belongs to this value, not the next label. */
  hint?: React.ReactNode;
}

/**
 * A checkbox value in the rail: its label, and the box beside it that saves on
 * change. The box shows the new state at once and returns to the saved one if
 * the save fails.
 */
function CheckboxProperty({
  label,
  value,
  entityType,
  entityId,
  fieldName,
  className,
}: Pick<
  InlinePropertyEditorProps,
  "label" | "value" | "entityType" | "entityId" | "fieldName" | "className"
>) {
  const [checked, setChecked] = useOptimistic(value === true);
  const [pending, startTransition] = useTransition();

  const onChange = (next: boolean) =>
    startTransition(async () => {
      setChecked(next);
      const result = await patchField(entityType, entityId, fieldName, next);
      if (isActionError(result)) toast.error(result.error);
    });

  return (
    <div className={cn("mb-2", className)}>
      <RailLabel
        action={
          <Checkbox
            aria-label={label}
            checked={checked}
            disabled={pending}
            onChange={(e) => onChange(e.target.checked)}
          />
        }
      >
        {label}
      </RailLabel>
    </div>
  );
}

/**
 * A link value as the rail reads it: the link itself, opened in a new tab, with
 * the edit its own button beside it rather than the whole value.
 */
function LinkValue({
  href,
  label,
  onEdit,
}: {
  href: string;
  label: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-1">
      <span className="min-w-0 flex-1 font-mono text-small text-ink-soft">
        <UrlDisplay value={href} />
      </span>
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit ${label}`}
        className={cn(
          "relative shrink-0 rounded-sm text-ink-faint hover:text-ink focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden coarse:after:absolute coarse:after:-inset-2",
          REVEAL_ON_HOVER
        )}
      >
        <IconPencil size={14} aria-hidden />
      </button>
    </div>
  );
}

/** What a stored value reads as when not being edited: the caller's readable
 *  form, else a select's option label, else the value itself. */
function readableText({
  value,
  options,
  displayValue,
}: Pick<InlinePropertyEditorProps, "value" | "options" | "displayValue">) {
  return (
    displayValue ??
    options?.find((o) => o.value === String(value))?.label ??
    String(value)
  );
}

/**
 * A property for a member who may not edit it: the label and the value as plain
 * text, with nothing to press, focus or hover. A link stays a link and a
 * copyable value stays copyable, since reading is what a viewer is here for.
 */
function ReadOnlyProperty({
  label,
  value,
  type,
  options,
  className,
  copyable,
  displayValue,
  hint,
}: InlinePropertyEditorProps) {
  const isEmpty = value === undefined || value === null || value === "";

  if (type === "checkbox") {
    return (
      <div className={cn("mb-2", className)}>
        <RailLabel
          action={<CheckboxDisplay value={value === true} label={label} />}
        >
          {label}
        </RailLabel>
      </div>
    );
  }

  const copyAction = copyable && !isEmpty && (
    <CopyButton value={String(value)} label={`Copy ${label.toLowerCase()}`} />
  );

  return (
    <div className={cn("mb-2 flex flex-col items-start", className)}>
      <RailLabel action={copyAction || undefined}>{label}</RailLabel>
      <div className="w-full font-mono text-small">
        {isEmpty ? (
          <span className="text-ink-faint">—</span>
        ) : type === "url" && typeof value === "string" ? (
          <span className="text-ink-soft">
            <UrlDisplay value={value} />
          </span>
        ) : (
          <span
            className={cn(
              "line-clamp-1 text-ink-soft",
              copyable && "phone:line-clamp-none phone:break-all"
            )}
            title={copyable ? String(value) : undefined}
          >
            {readableText({ value, options, displayValue })}
          </span>
        )}
      </div>
      {hint != null && !isEmpty && (
        <p className="mt-0.5 text-micro text-ink-soft">{hint}</p>
      )}
    </div>
  );
}

/**
 * A rail property, edited in place by an editor and read as plain text by
 * anyone below it. The gate is cosmetic; the server refuses a viewer's write
 * either way. Outside a project route there is no role, so nothing is
 * editable.
 */
export default function InlinePropertyEditor(props: InlinePropertyEditorProps) {
  const canEdit = useProjectRole()?.can("editor") ?? false;
  if (!canEdit) return <ReadOnlyProperty {...props} />;
  return props.type === "checkbox" ? (
    <CheckboxProperty {...props} />
  ) : (
    <DraftPropertyEditor {...props} />
  );
}

function DraftPropertyEditor({
  label,
  value,
  type,
  entityType,
  entityId,
  fieldName,
  options,
  clearable = type === "date",
  placeholder,
  className,
  copyable,
  displayValue: readableValue,
  hint,
}: InlinePropertyEditorProps) {
  // An empty draft clears a clearable value; the rest refuse a blank save.
  const prepare = useCallback(
    (draft: string) => {
      if (!draft) return clearable ? CLEAR : null;
      return type === "number" ? Number(draft) : draft;
    },
    [type, clearable]
  );

  const edit = useInlineEdit({
    entityType,
    entityId,
    fieldName,
    value: String(value ?? ""),
    prepare,
  });

  const isMobile = useIsMobile();
  const [optimisticSelect, setOptimisticSelect] = useOptimistic(
    value === undefined || value === null ? "" : String(value)
  );
  const [selectPending, startSelectTransition] = useTransition();

  const effectiveValue = type === "select" ? optimisticSelect : value;
  const isEmpty =
    effectiveValue === undefined ||
    effectiveValue === null ||
    effectiveValue === "";
  // A select's value is an option's; it reads as that option's label, or as
  // itself once the option is gone.
  const displayValue = isEmpty
    ? `Add ${label.toLowerCase()}`
    : readableText({
        value: effectiveValue,
        options,
        displayValue: readableValue,
      });
  const isLink = type === "url" && typeof value === "string" && value !== "";
  const valueClassName = cn(
    "-mx-1 line-clamp-1 h-fit w-full rounded-md px-1 py-0.5 text-left font-mono text-small motion-ink",
    "hover:bg-ink/4 focus-visible:bg-ink/4 focus-visible:ring-2 focus-visible:ring-art/40 focus-visible:outline-hidden",
    "coarse:min-h-11 coarse:pr-6",
    copyable && "phone:line-clamp-none phone:break-all",
    isEmpty
      ? "text-ink-faint italic group-hover:text-ink-soft"
      : "text-ink-soft group-hover:text-ink"
  );

  const copyAction = copyable && !isEmpty && (
    <CopyButton value={String(value)} label={`Copy ${label.toLowerCase()}`} />
  );

  const handleSelectOption = (next: string) => {
    if (next === String(value ?? "")) return;
    startSelectTransition(async () => {
      setOptimisticSelect(next);
      const result = await patchField(entityType, entityId, fieldName, next);
      if (isActionError(result)) toast.error(result.error);
    });
  };

  const handleClearSelect = () => {
    startSelectTransition(async () => {
      setOptimisticSelect("");
      const result = await patchField(entityType, entityId, fieldName, null);
      if (isActionError(result)) toast.error(result.error);
    });
  };

  const valueButton = (
    <button
      type={"button"}
      onClick={type === "select" ? undefined : edit.begin}
      disabled={type === "select" ? selectPending : undefined}
      aria-label={`${displayValue} — Edit ${label}`}
      className={valueClassName}
    >
      {displayValue}
    </button>
  );

  const inputEl = (
    <Input
      type={type}
      value={edit.draft}
      onChange={(e) => edit.setDraft(e.target.value)}
      onKeyDown={edit.onKeyDown}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={edit.error != null}
      className="w-full md:text-small fine:h-6 coarse:h-11"
      autoFocus={!isMobile}
    />
  );

  return (
    <m.div
      layout
      transition={SPRING.surface}
      className={cn("relative", className)}
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
              "flex flex-col items-start motion-reveal data-saving:pointer-events-none data-saving:opacity-50"
            }
          >
            <RailLabel>{label}</RailLabel>
            <div className="mb-2 flex w-full items-center gap-1">
              {inputEl}
              <InlineEditActions
                label={label.toLowerCase()}
                onConfirm={edit.submit}
                onCancel={edit.cancel}
                disabled={edit.isSaving}
              />
            </div>
            {edit.error && (
              <p role={"alert"} className={"mb-2 text-micro text-danger"}>
                {edit.error}
              </p>
            )}
          </m.div>
        ) : (
          <m.div
            key={"show"}
            variants={OPTICAL}
            initial={"hidden"}
            animate={"shown"}
            exit={"leaving"}
            className={"group relative mb-2 flex flex-col items-start"}
          >
            <RailLabel action={copyAction || undefined}>{label}</RailLabel>
            {isLink ? (
              <LinkValue href={value} label={label} onEdit={edit.begin} />
            ) : type === "select" ? (
              <div className="relative w-full">
                <ResponsivePicker
                  title={label}
                  options={
                    options?.map((opt) => ({
                      value: opt.value,
                      label: opt.label,
                    })) ?? []
                  }
                  value={optimisticSelect || undefined}
                  onSelect={handleSelectOption}
                  showClear={clearable && optimisticSelect !== ""}
                  onClear={handleClearSelect}
                  clearLabel="Clear"
                  trigger={valueButton}
                />
                <IconPencil
                  size={14}
                  aria-hidden={"true"}
                  className={cn(
                    "pointer-events-none absolute right-0 bottom-0.5 text-ink-faint",
                    REVEAL_ON_HOVER
                  )}
                />
              </div>
            ) : (
              <div className="relative w-full">
                {copyable && !isEmpty ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{valueButton}</TooltipTrigger>
                    <TooltipContent className="max-w-md font-mono break-all">
                      {String(value)}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  valueButton
                )}
                <IconPencil
                  size={14}
                  aria-hidden={"true"}
                  className={cn(
                    "pointer-events-none absolute right-0 bottom-0.5 text-ink-faint",
                    REVEAL_ON_HOVER
                  )}
                />
              </div>
            )}
            {hint != null && !isEmpty && (
              <p className="mt-0.5 text-micro text-ink-soft">{hint}</p>
            )}
          </m.div>
        )}
      </AnimatePresence>
    </m.div>
  );
}
