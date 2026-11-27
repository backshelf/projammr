import type {
  FieldConfig,
  FieldDraftProps,
  FieldEditorProps,
  FieldKind,
} from "@/fields/types";
import { Input } from "@workspace/ui/components/input";
import {
  type ChangeEvent,
  type ComponentProps,
  type ComponentType,
  type KeyboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

/** The `<input>` attributes a text-entry kind chooses for itself. */
export type InputAttributes = Pick<
  ComponentProps<"input">,
  "inputMode" | "type"
> & {
  /** Offers `config.suggestions` as a `<datalist>` on the input. */
  suggest?: boolean;
};

/**
 * The `list` attribute and the `<datalist>` for an input that suggests, or
 * nothing when the kind does not suggest or the config has no suggestions.
 */
function useSuggestions(config: FieldConfig, suggest: boolean | undefined) {
  const id = useId();
  const suggestions = suggest ? config.suggestions : undefined;
  if (!suggestions?.length) return { list: undefined, datalist: null };
  return {
    list: id,
    datalist: (
      <datalist id={id}>
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    ),
  };
}

/**
 * Validation feedback anchored beneath an inline table input. Positioned out
 * of document flow so showing or clearing an error never shifts the row's
 * height.
 */
export function FloatingFieldError({ message }: { message: string }) {
  return (
    <span
      role="alert"
      className="pointer-events-none absolute top-full left-0 z-20 mt-1 max-w-64 rounded-md border border-danger/30 bg-paper px-2 py-1 text-small whitespace-normal text-danger shadow-menu"
    >
      {message}
    </span>
  );
}

/**
 * The cell editor of a kind entered as one line of text. It starts from `seed`
 * or the value's own text, and commits only what `parse` accepts: a parse error
 * floats beneath the input and keeps the editor open. Enter commits; Escape and
 * blur cancel.
 */
export function inputEditor(
  { parse, format }: Pick<FieldKind, "parse" | "format">,
  { suggest, ...attributes }: InputAttributes = {}
): ComponentType<FieldEditorProps> {
  return function InputEditor({ value, config, seed, onCommit, onCancel }) {
    const [draft, setDraft] = useState(() => seed ?? format(value, config));
    const [error, setError] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const { list, datalist } = useSuggestions(config, suggest);

    useEffect(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      // A date input has no selection to move, and `setSelectionRange` throws.
      if (input.type === "text") {
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }, []);

    const commit = () => {
      const result = parse(draft, config);
      if (result.ok) onCommit(result.value);
      else setError(result.error);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
      // Arrows, Enter and Escape stay in the editor rather than reaching the
      // grid's navigation handler.
      e.stopPropagation();
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        onCancel();
      }
    };

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      setDraft(e.target.value);
      setError(null);
    };

    return (
      <div className="relative flex w-full items-center">
        <Input
          ref={inputRef}
          type="text"
          {...attributes}
          list={list}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={onCancel}
          placeholder={config.placeholder}
          aria-invalid={error !== null || undefined}
          className="-my-1 h-7 md:text-small"
        />
        {datalist}
        {error && <FloatingFieldError message={error} />}
      </div>
    );
  };
}

/** The draft-row input of a kind entered as one line of text. */
export function inputDraft({
  suggest,
  ...attributes
}: InputAttributes = {}): ComponentType<FieldDraftProps> {
  return function InputDraft({
    raw,
    config,
    onChange,
    onBlur,
    ref,
    invalid,
    id,
    "aria-describedby": describedBy,
  }) {
    const { list, datalist } = useSuggestions(config, suggest);
    return (
      <>
        <Input
          id={id}
          type="text"
          {...attributes}
          list={list}
          value={raw}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          ref={ref}
          placeholder={
            config.placeholder && config.required
              ? `${config.placeholder} *`
              : config.placeholder
          }
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="h-7 md:text-small"
        />
        {datalist}
      </>
    );
  };
}
