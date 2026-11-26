"use client";

import {
  BlockEditor,
  type BlockEditorProps,
} from "@workspace/ui/components/block-editor";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import {
  InputGroup,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useHydrated } from "@workspace/ui/hooks/use-hydrated";
import { cn } from "@workspace/ui/lib/utils";
import React from "react";
import { Control, Controller, FieldValues, Path } from "react-hook-form";

// The editor is browser-only, so the first client render has to match the
// server's empty placeholder before its variant chunk is allowed in.
function ClientBlockEditor(props: BlockEditorProps) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return <div className="min-h-6" />;
  }

  return <BlockEditor {...props} />;
}

export type FormControllerType = "title" | "input" | "select" | "blocknote";

export interface FormControllerProps<T extends FieldValues> {
  name: Path<T>;
  control: Control<T>;
  label: string;
  description?: React.ReactNode;
  type?: FormControllerType;
  id?: string;
  placeholder?: string;
  inputType?: React.ComponentProps<typeof Input>["type"];
  options?: string[];
  blocknotePlaceholder?: string;
  className?: string;
  readOnly?: boolean;
  /** A control rendered inside the input's trailing edge (a remove button). */
  trailing?: React.ReactNode;
}

export function FormController<T extends FieldValues>({
  name,
  control,
  label,
  description,
  type = "input",
  id,
  placeholder,
  inputType,
  options,
  blocknotePlaceholder,
  className,
  readOnly,
  trailing,
}: FormControllerProps<T>) {
  const fieldId = id || (name as string);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        let input: React.ReactNode;
        switch (type) {
          case "blocknote":
            input = (
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
                />
              </div>
            );
            break;
          case "title":
            input = (
              <input
                {...field}
                id={fieldId}
                aria-invalid={fieldState.invalid}
                type="text"
                placeholder={placeholder}
                className={cn(
                  "w-full rounded-none border-0 border-b border-input bg-transparent px-0 py-1.5 font-heading text-3xl motion-ink placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-muted-foreground focus:ring-0 focus-visible:border-ring focus-visible:ring-0 focus-visible:ring-offset-0 aria-invalid:border-destructive",
                  className
                )}
              />
            );
            break;
          case "select":
            if (options) {
              input = (
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  items={options.map((option) => ({
                    value: option,
                    label: option,
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              );
            } else {
              input = null;
            }
            break;
          default:
            input = trailing ? (
              <InputGroup>
                <InputGroupInput
                  {...field}
                  id={fieldId}
                  type={inputType}
                  placeholder={placeholder}
                  readOnly={readOnly}
                  aria-invalid={fieldState.invalid}
                />
                {trailing}
              </InputGroup>
            ) : (
              <Input
                {...field}
                id={fieldId}
                type={inputType}
                placeholder={placeholder}
                readOnly={readOnly}
                aria-invalid={fieldState.invalid}
              />
            );
        }

        return (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
            {description && <FieldDescription>{description}</FieldDescription>}
            {input}
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        );
      }}
    />
  );
}
