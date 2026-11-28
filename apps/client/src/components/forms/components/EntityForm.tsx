"use client";

import {
  fieldKindResolver,
  unwrapStatuses,
} from "@/components/forms/components/field-resolver";
import { FormFoot, FormRow } from "@/components/forms/components/FormLayout";
import { fieldKind } from "@/fields";
import type { FieldConfig, FieldKind, FieldKindName } from "@/fields/types";
import { useShellPolicy } from "@/lib/policies/provider";
import type { ActionError, Status } from "@workspace/api/api";
import { isActionError } from "@workspace/api/lib/action-result";
import type { BlockEditorProps } from "@workspace/ui/components/block-editor";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field";
import {
  FormController,
  type FormControllerProps,
} from "@workspace/ui/components/forms/form-controller";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Spinner } from "@workspace/ui/components/spinner";
import { useHydrated } from "@workspace/ui/hooks/use-hydrated";
import { LABEL } from "@workspace/ui/lib/shell";
import { cn } from "@workspace/ui/lib/utils";
import { IconChevronRight } from "@tabler/icons-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Suspense,
  use,
  useEffect,
  useEffectEvent,
  useState,
  type ComponentType,
  type ReactNode,
  type RefCallback,
} from "react";
import {
  Controller,
  type DefaultValues,
  type FieldValues,
  type Path,
  useForm,
  type UseFormReturn,
} from "react-hook-form";
import { toast } from "sonner";

const BlockNoteEditor: ComponentType<BlockEditorProps> = dynamic(
  () =>
    import("@workspace/ui/components/block-editor").then(
      (next) => next.BlockEditor
    ),
  { ssr: false }
);

function ClientBlockEditor(props: BlockEditorProps) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return <div className="min-h-6" />;
  }

  return <BlockNoteEditor {...props} />;
}

/**
 * One row of a create form. A plain field renders through `FormController`;
 * `blocknote` lazy-loads the rich editor on the client only where an entity
 * form needs it; `field-kind` renders one of the field kinds' own draft input,
 * validated by its own `parse`; `pair` puts two short fields on one row;
 * `custom` hands the form to the caller for anything else (a field array),
 * with an optional `validate` the resolver runs on the field's own raw value.
 */
export type FieldSpec<T extends FieldValues> =
  | ({ kind?: "field"; name: Path<T> } & Omit<
      FormControllerProps<T>,
      "name" | "control"
    >)
  | {
      kind?: "field";
      name: Path<T>;
      type: "blocknote";
      label: string;
      description?: ReactNode;
      id?: string;
      placeholder?: string;
      blocknotePlaceholder?: string;
      className?: string;
    }
  | {
      kind: "field-kind";
      name: Path<T>;
      field: FieldKindName;
      config?: FieldConfig;
      label: string;
      hint?: string;
      required?: boolean;
      statuses?: Promise<Status[] | ActionError>;
    }
  | { kind: "pair"; fields: FieldSpec<T>[] }
  | {
      kind: "disclosure";
      key: string;
      label: string;
      mobileOnly?: boolean;
      fields: FieldSpec<T>[];
    }
  | {
      kind: "custom";
      key: string;
      render: (form: UseFormReturn<T>) => ReactNode;
      /** Errors keyed by the field path relative to the form (`"links.0.url"`). */
      validate?: (value: unknown) => Record<string, string>;
    };

/**
 * The create-form skeleton every entity form shares: a resolved form, and a
 * submit that calls the action, toasts the outcome, and then does what the
 * shell policy's `afterCreate` says: opens the created record's page
 * (`createdHref`), goes back to where the form was opened from, or empties
 * the form for the next one with focus on its first field. Either of the last
 * two toasts a link to the record. `fields` resolves through each
 * `field-kind` spec's own kind (`fieldKindResolver`), so the submit handler
 * receives values already parsed to their kind's type rather than the raw
 * strings the form holds.
 */
export function useEntityForm<
  TRaw extends FieldValues,
  TOut extends FieldValues,
  R,
>(props: {
  fields: FieldSpec<TRaw>[];
  defaultValues: DefaultValues<TRaw>;
  submit: (data: TOut) => Promise<R | ActionError>;
  /** The success toast, from the created record. */
  created: (result: R) => string;
  /** The created record's own page. */
  createdHref: (result: R) => string;
  /**
   * How "stay where I was" leaves a form mounted in place, such as closing
   * the dialog it sits in. Without it the form is its own route, and staying
   * goes back to the page it was opened from.
   */
  onStay?: () => void;
}): {
  form: UseFormReturn<TRaw, unknown, TOut>;
  onSubmit: (data: TOut) => Promise<void>;
} {
  const { fields, defaultValues, submit, created, createdHref, onStay } = props;
  const router = useRouter();
  const { afterCreate } = useShellPolicy();
  const form = useForm<TRaw, unknown, TOut>({
    resolver: fieldKindResolver(fields),
    mode: "onTouched",
    defaultValues,
  });

  // An emptied form starts again on its first field. `reset` drops the field
  // refs `setFocus` reaches for, so the focus waits for the render after it.
  const [emptied, setEmptied] = useState(0);
  const focusFirstField = useEffectEvent(() => {
    const first = firstFieldName(fields);
    if (first) form.setFocus(first);
  });
  useEffect(() => {
    if (emptied > 0) focusFirstField();
  }, [emptied]);

  const onSubmit = async (data: TOut) => {
    const result = await submit(data);
    if (result && typeof result === "object" && isActionError(result)) {
      toast.error((result as ActionError).error);
      return;
    }
    const record = result as R;
    const href = createdHref(record);

    if (afterCreate === "open") {
      toast.success(created(record));
      router.push(href);
      return;
    }

    toast.success(created(record), {
      action: { label: "Open", onClick: () => router.push(href) },
    });
    if (afterCreate === "stay") {
      if (onStay) onStay();
      else router.back();
      return;
    }
    form.reset(defaultValues);
    setEmptied((count) => count + 1);
  };

  return { form, onSubmit };
}

/** The first field a form's specs render, the one a fresh form starts on. */
function firstFieldName<T extends FieldValues>(
  fields: FieldSpec<T>[]
): Path<T> | undefined {
  for (const spec of fields) {
    switch (spec.kind) {
      case "pair":
      case "disclosure": {
        const name = firstFieldName(spec.fields);
        if (name) return name;
        break;
      }
      case "custom":
        break;
      default:
        return spec.name;
    }
  }
  return undefined;
}

function FieldSpecRow<T extends FieldValues>({
  spec,
  form,
}: {
  spec: FieldSpec<T>;
  form: UseFormReturn<T>;
}) {
  switch (spec.kind) {
    case "field-kind":
      return <FieldKindRow spec={spec} form={form} />;
    case "pair":
      return (
        <>
          {spec.fields.map((field) => (
            <FieldSpecRow key={specKey(field)} spec={field} form={form} />
          ))}
        </>
      );
    case "disclosure":
      return <FormDisclosure spec={spec} form={form} />;
    case "custom":
      return <>{spec.render(form)}</>;
    default:
      if (spec.type === "blocknote") {
        return <BlockNoteFieldRow spec={spec} form={form} />;
      }
      return <FormController control={form.control} {...spec} />;
  }
}

function BlockNoteFieldRow<T extends FieldValues>({
  spec,
  form,
}: {
  spec: Extract<FieldSpec<T>, { type: "blocknote" }>;
  form: UseFormReturn<T>;
}) {
  const {
    name,
    label,
    description,
    id,
    placeholder,
    blocknotePlaceholder,
    className,
  } = spec;
  const fieldId = id || (name as string);

  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
          {description && <FieldDescription>{description}</FieldDescription>}
          <div
            className={cn(
              "doc rounded-md border border-input bg-input/20 px-3 py-2 motion-ink focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 aria-invalid:border-destructive dark:bg-input/30 [&_.bn-editor]:px-0",
              className
            )}
          >
            <ClientBlockEditor
              value={field.value || ""}
              onChange={(json: string) => field.onChange(json)}
              placeholder={blocknotePlaceholder || placeholder}
              ariaLabel={label}
            />
          </div>
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

function specKey<T extends FieldValues>(spec: FieldSpec<T>): string {
  switch (spec.kind) {
    case "pair":
      return spec.fields.map(specKey).join("+");
    case "disclosure":
    case "custom":
      return spec.key;
    default:
      return String(spec.name);
  }
}

function disclosureHasError<T extends FieldValues>(
  fields: FieldSpec<T>[],
  errors: Record<string, unknown>
): boolean {
  return fields.some((spec) => {
    if (spec.kind === "pair" || spec.kind === "disclosure") {
      return disclosureHasError(spec.fields, errors);
    }
    if (spec.kind === "custom") return false;
    return errors[spec.name as string] != null;
  });
}

function FormDisclosure<T extends FieldValues>({
  spec,
  form,
}: {
  spec: Extract<FieldSpec<T>, { kind: "disclosure" }>;
  form: UseFormReturn<T>;
}) {
  const [open, setOpen] = useState(false);
  const hasError = disclosureHasError(
    spec.fields,
    form.formState.errors as Record<string, unknown>
  );
  const shown = open || hasError;

  return (
    <div className="border-t border-rule">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={shown}
        className={cn(
          LABEL,
          "flex min-h-11 w-full items-center justify-between py-3 text-left text-ink-soft hover:text-ink",
          spec.mobileOnly && "md:hidden"
        )}
      >
        <span>{spec.label}</span>
        <IconChevronRight
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-ink-faint motion-move",
            shown && "rotate-90"
          )}
        />
      </button>
      <div className={cn(!shown && "hidden", spec.mobileOnly && "md:contents")}>
        {spec.fields.map((child) => (
          <FormRow
            key={specKey(child)}
            pair={child.kind === "pair"}
            className="first:border-t first:border-rule"
          >
            <FieldSpecRow spec={child} form={form} />
          </FormRow>
        ))}
      </div>
    </div>
  );
}

/**
 * A `field-kind` row: the same `Field` wrapper `FormController` renders,
 * with the kind's own `DraftInput` in place of a `FormController` type. The
 * input carries `id`, `invalid`, `aria-describedby` (the hint and the error)
 * and `aria-labelledby` (the label) so both attach to it the way
 * `FormController` never has — `aria-labelledby` is what reaches a kind
 * like `status`, whose trigger isn't a `htmlFor`-labelable element.
 */
function FieldKindRow<T extends FieldValues>({
  spec,
  form,
}: {
  spec: Extract<FieldSpec<T>, { kind: "field-kind" }>;
  form: UseFormReturn<T>;
}) {
  const { name, field, config, label, hint, required, statuses } = spec;
  const id = name as string;
  const labelId = `${id}-label`;
  const descriptionId = hint ? `${id}-description` : undefined;
  const errorId = `${id}-error`;
  const kind = fieldKind(field);

  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field: controllerField, fieldState }) => {
        const describedBy =
          [descriptionId, fieldState.invalid ? errorId : undefined]
            .filter(Boolean)
            .join(" ") || undefined;

        return (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel id={labelId} htmlFor={id}>
              {label}
            </FieldLabel>
            {hint && (
              <FieldDescription id={descriptionId}>{hint}</FieldDescription>
            )}
            <Suspense fallback={<Skeleton className="h-7 w-full" />}>
              <FieldKindInput
                kind={kind}
                id={id}
                raw={
                  typeof controllerField.value === "string"
                    ? controllerField.value
                    : ""
                }
                onChange={controllerField.onChange}
                onBlur={controllerField.onBlur}
                ref={controllerField.ref}
                invalid={fieldState.invalid}
                describedBy={describedBy}
                labelledBy={labelId}
                config={config}
                required={required}
                statuses={statuses}
              />
            </Suspense>
            {fieldState.invalid && (
              <FieldError id={errorId} errors={[fieldState.error]} />
            )}
          </Field>
        );
      }}
    />
  );
}

/**
 * The kind's `DraftInput` alone, isolated so a pending `statuses` promise
 * suspends only this input under its own `Suspense` above, not the rest of
 * the form.
 */
function FieldKindInput({
  kind,
  id,
  raw,
  onChange,
  onBlur,
  ref,
  invalid,
  describedBy,
  labelledBy,
  config,
  required,
  statuses,
}: {
  kind: FieldKind;
  id: string;
  raw: string;
  onChange: (raw: string) => void;
  onBlur?: () => void;
  ref?: RefCallback<HTMLElement>;
  invalid: boolean;
  describedBy?: string;
  labelledBy?: string;
  config?: FieldConfig;
  required?: boolean;
  statuses?: Promise<Status[] | ActionError>;
}) {
  const resolvedStatuses = statuses
    ? unwrapStatuses(use(statuses))
    : config?.statuses;
  const DraftInput = kind.DraftInput;

  return (
    <DraftInput
      id={id}
      raw={raw}
      config={{ ...config, required, statuses: resolvedStatuses }}
      onChange={onChange}
      onBlur={onBlur}
      ref={ref}
      invalid={invalid}
      aria-describedby={describedBy}
      aria-labelledby={labelledBy}
    />
  );
}

/**
 * A create form: one `FormRow` per spec, then the foot with Cancel and the
 * submit button, which shows a spinner and disables while submitting.
 */
export function EntityForm<
  TRaw extends FieldValues,
  TOut extends FieldValues = TRaw,
>({
  id,
  form,
  onSubmit,
  fields,
  submitLabel,
  busyLabel,
  onCancel,
}: {
  id: string;
  form: UseFormReturn<TRaw, unknown, TOut>;
  onSubmit: (data: TOut) => Promise<void>;
  fields: FieldSpec<TRaw>[];
  submitLabel: string;
  busyLabel: string;
  onCancel?: () => void;
}) {
  const router = useRouter();
  const isSubmitting = form.formState.isSubmitting;

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      // The browser's own constraint validation (an `inputType="url"`
      // field, say) blocks the submit event before it ever reaches
      // react-hook-form, silently defeating a field-kind's or a custom
      // spec's own error message.
      noValidate
      id={id}
      className="flex flex-col"
    >
      {fields.map((spec) =>
        spec.kind === "disclosure" ? (
          <FormDisclosure
            key={specKey(spec)}
            spec={spec}
            form={form as unknown as UseFormReturn<TRaw>}
          />
        ) : (
          <FormRow key={specKey(spec)} pair={spec.kind === "pair"}>
            {/* `FieldSpecRow` only reads raw field values and `form.control`;
                it never calls `handleSubmit`, so the parsed-output generic a
                field-kind resolver adds here does not concern it. */}
            <FieldSpecRow
              spec={spec}
              form={form as unknown as UseFormReturn<TRaw>}
            />
          </FormRow>
        )
      )}
      <FormFoot>
        <Button
          type="button"
          variant="ghost"
          onClick={() => (onCancel ? onCancel() : router.back())}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" form={id} disabled={isSubmitting}>
          {isSubmitting && <Spinner />}
          {isSubmitting ? busyLabel : submitLabel}
        </Button>
      </FormFoot>
    </form>
  );
}
