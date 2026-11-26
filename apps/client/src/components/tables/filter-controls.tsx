"use client";

import { fieldKind } from "@/fields";
import { IconFilter } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ComponentProps,
  type ComponentType,
  type FormEvent,
  type ReactNode,
  useId,
  useState,
} from "react";

import type {
  ChoiceFilterConfig,
  FilterColumnConfig,
  RangeFilterConfig,
  TextFilterConfig,
} from "./generic-table-types";

/*
 * The filter controls a column can have beyond a single choice: a range with
 * open ends (a number or date custom field), free text (a text custom field),
 * and the membership a multiple choice holds. The encodings are the server's:
 * `<from>..<to>` for a range, option values comma-separated for a membership,
 * and the text as typed.
 */

/** A range's two ends as typed, either blank when that end is open. */
export function rangeEnds(value: string | null): { from: string; to: string } {
  if (!value?.includes("..")) return { from: "", to: "" };
  const [from = "", to = ""] = value.split("..");
  return { from, to };
}

/** The filter value for a range, or null when both ends are open. */
export function rangeValue(from: string, to: string): string | null {
  const start = from.trim();
  const end = to.trim();
  return start === "" && end === "" ? null : `${start}..${end}`;
}

/**
 * The option values a choice filter holds: a multiple one's comma-separated
 * set, or a single one's whole value, which may hold a comma of its own (an
 * artist's name).
 */
export function memberValues(
  value: string | null,
  multiple: boolean | undefined
): string[] {
  if (!value) return [];
  return multiple ? value.split(",").filter(Boolean) : [value];
}

/** A membership filter's value once `option` is flipped in or out of it. */
export function toggleMember(
  value: string | null,
  option: string
): string | null {
  const members = memberValues(value, true);
  const next = members.includes(option)
    ? members.filter((member) => member !== option)
    : [...members, option];
  return next.length > 0 ? next.join(",") : null;
}

/** A range as it reads: both ends, or the one that bounds it. */
function rangeSummary(_config: RangeFilterConfig, value: string) {
  const { from, to } = rangeEnds(value);
  if (from && to) return `${from}–${to}`;
  if (from) return `≥ ${from}`;
  return to ? `≤ ${to}` : null;
}

/** A choice as it reads: its option's label, and how many more it holds. */
function choiceSummary(config: ChoiceFilterConfig, value: string) {
  const labelOf = (member: string) =>
    config.options.find((option) => option.value === member)?.label ?? member;
  const members = memberValues(value, config.multiple);
  if (config.multiple && config.listed) {
    const offered = config.options.map((option) => option.value);
    const known = offered.filter((option) => members.includes(option));
    const unknown = members.filter((member) => !offered.includes(member));
    const names = [...known, ...unknown].map(labelOf);
    return names.length > 0 ? names.join(", ") : null;
  }
  const [first, ...rest] = members;
  if (first === undefined) return null;
  return rest.length > 0 ? `${labelOf(first)} +${rest.length}` : labelOf(first);
}

/** The ends of a range that `parse` with its kind, or the first reason one does not. */
function checkRange(
  config: RangeFilterConfig,
  from: string,
  to: string
): string | null {
  const kind = fieldKind(config.input);
  const ends = [
    ["From", from],
    ["To", to],
  ] as const;
  const parsed: (number | string | null)[] = [];
  for (const [name, raw] of ends) {
    const result = kind.parse(raw, {});
    if (!result.ok) return `${name}: ${result.error}`;
    parsed.push(result.value as number | string | null);
  }
  const [start, end] = parsed;
  if (start != null && end != null && start > end) return "From is after To";
  return null;
}

/** The two buttons every typed filter ends with. */
function FilterActions({
  canClear,
  onClear,
}: {
  canClear: boolean;
  onClear: () => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canClear}
        onClick={onClear}
      >
        Clear
      </Button>
      <Button type="submit" size="sm">
        Apply
      </Button>
    </div>
  );
}

/**
 * A range filter's form: a From and a To typed with the filter's kind, either
 * left empty to leave that end open. Apply writes the range; an end that does
 * not read, or a From past the To, says so under the inputs and writes
 * nothing. Enter in either input applies.
 */
function RangeForm({
  config,
  value,
  onChange,
  touch,
}: {
  config: RangeFilterConfig;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Sized for a finger, for the phone sheet. */
  touch?: boolean;
}) {
  const [draft, setDraft] = useState(() => rangeEnds(value));
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const date = config.input === "date";
  const inputProps = {
    type: date ? "date" : "text",
    inputMode: date ? undefined : ("decimal" as const),
    className: cn("tabular-nums", touch && "coarse:h-11"),
    "aria-describedby": `${id}-note`,
    "aria-invalid": error ? true : undefined,
  };

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const problem = checkRange(config, draft.from, draft.to);
    setError(problem);
    if (!problem) onChange(rangeValue(draft.from, draft.to));
  };

  return (
    <form aria-label={`Filter by ${config.label}`} onSubmit={apply}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-from`} className="text-micro text-ink-soft">
            From
          </Label>
          <Input
            id={`${id}-from`}
            value={draft.from}
            placeholder={date ? undefined : "Any"}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            {...inputProps}
          />
        </div>
        <span aria-hidden className="pb-1 text-ink-faint">
          –
        </span>
        <div className="grid gap-1">
          <Label htmlFor={`${id}-to`} className="text-micro text-ink-soft">
            To
          </Label>
          <Input
            id={`${id}-to`}
            value={draft.to}
            placeholder={date ? undefined : "Any"}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            {...inputProps}
          />
        </div>
      </div>
      <p
        id={`${id}-note`}
        role={error ? "alert" : undefined}
        className={cn(
          "mt-1.5 text-micro text-pretty",
          error ? "text-danger" : "text-ink-soft"
        )}
      >
        {error ?? "Leave an end empty to leave it open."}
      </p>
      <FilterActions
        canClear={value !== null}
        onClear={() => {
          setDraft({ from: "", to: "" });
          setError(null);
          onChange(null);
        }}
      />
    </form>
  );
}

/** A text filter's form: the text the column must contain, applied on Enter. */
function TextForm({
  config,
  value,
  onChange,
  touch,
}: {
  config: TextFilterConfig;
  value: string | null;
  onChange: (value: string | null) => void;
  touch?: boolean;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const id = useId();

  return (
    <form
      aria-label={`Filter by ${config.label}`}
      onSubmit={(event) => {
        event.preventDefault();
        onChange(draft.trim() || null);
      }}
    >
      <Label htmlFor={id} className="text-micro text-ink-soft">
        Contains
      </Label>
      <Input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className={cn("mt-1", touch && "coarse:h-11")}
      />
      <FilterActions
        canClear={value !== null}
        onClear={() => {
          setDraft("");
          onChange(null);
        }}
      />
    </form>
  );
}

/** The trigger every filter shares: its label, and what it holds when active. */
function FilterTrigger({
  config,
  filterValue,
  ...props
}: {
  config: FilterColumnConfig;
  filterValue: string | null;
} & ComponentProps<typeof Button>) {
  const summary = filterSummary(config, filterValue);
  return (
    <Button variant="outline" size="sm" {...props}>
      <IconFilter className="h-4 w-4" aria-hidden />
      {summary ? `${config.label}: ${summary}` : config.label}
    </Button>
  );
}

/** A typed filter on the desktop toolbar: its trigger, and its form in a popover. */
function TypedFilterMenu({
  config,
  value,
  children,
}: {
  config: FilterColumnConfig;
  value: string | null;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <FilterTrigger config={config} filterValue={value} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

export type FilterControlProps<C extends FilterColumnConfig> = {
  config: C;
  value: string | null;
  counts?: Record<string, number>;
  onChange: (value: string | null) => void;
};

/**
 * A server-backed column filter picked from a list: a dropdown of the column's
 * values, each with its live row count from the server facet unless the filter
 * is not counted, plus a "clear" entry. A single choice replaces the value; a
 * multiple one flips each option in or out of the set and stays open for the
 * next. Either refetches the page with the matching query param set.
 */
function ChoiceFilterMenu({
  config,
  value,
  counts = {},
  onChange,
}: FilterControlProps<ChoiceFilterConfig>) {
  const members = memberValues(value, config.multiple);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <FilterTrigger config={config} filterValue={value} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>{config.label}</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={value == null}
          onClick={() => onChange(null)}
        >
          All
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {config.options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={members.includes(option.value)}
            closeOnClick={!config.multiple}
            onCheckedChange={(checked) =>
              onChange(
                config.multiple
                  ? toggleMember(value, option.value)
                  : checked
                    ? option.value
                    : null
              )
            }
          >
            {option.label}
            {config.counted !== false && (
              <span className="ml-auto pl-4 text-micro text-ink-soft tabular-nums">
                {counts[option.value] ?? 0}
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A range filter on the desktop toolbar; applying or clearing closes it. */
function RangeFilterMenu({
  config,
  value,
  onChange,
}: FilterControlProps<RangeFilterConfig>) {
  return (
    <TypedFilterMenu config={config} value={value}>
      {(close) => (
        <RangeForm
          config={config}
          value={value}
          onChange={(next) => {
            onChange(next);
            close();
          }}
        />
      )}
    </TypedFilterMenu>
  );
}

/** A text filter on the desktop toolbar; applying or clearing closes it. */
function TextFilterMenu({
  config,
  value,
  onChange,
}: FilterControlProps<TextFilterConfig>) {
  return (
    <TypedFilterMenu config={config} value={value}>
      {(close) => (
        <TextForm
          config={config}
          value={value}
          onChange={(next) => {
            onChange(next);
            close();
          }}
        />
      )}
    </TypedFilterMenu>
  );
}

type ControlName = NonNullable<FilterColumnConfig["control"]>;
type ConfigOf<K extends ControlName> = Extract<
  FilterColumnConfig,
  { control?: K }
>;

/**
 * What each kind of filter control knows about itself: how an active value
 * reads, the desktop toolbar's menu, and, for a typed control, the form the
 * phone sheet opens in place of an option list.
 */
type FilterControl<C extends FilterColumnConfig> = {
  summary: (config: C, value: string) => string | null;
  Menu: ComponentType<FilterControlProps<C>>;
  Form?: ComponentType<{
    config: C;
    value: string | null;
    onChange: (value: string | null) => void;
    touch?: boolean;
  }>;
};

const FILTER_CONTROLS: { [K in ControlName]: FilterControl<ConfigOf<K>> } = {
  choice: { summary: choiceSummary, Menu: ChoiceFilterMenu },
  range: { summary: rangeSummary, Menu: RangeFilterMenu, Form: RangeForm },
  text: {
    summary: (_config, value) => `“${value}”`,
    Menu: TextFilterMenu,
    Form: TextForm,
  },
};

/** The control that enters `config`, a single choice when it names none. */
export function filterControl(
  config: FilterColumnConfig
): FilterControl<FilterColumnConfig> {
  // The entry is the one keyed by the config's own control, so it takes that
  // config; TypeScript cannot follow a key it reads at run time.
  return FILTER_CONTROLS[
    config.control ?? "choice"
  ] as FilterControl<FilterColumnConfig>;
}

/**
 * What an active filter reads as beside its label ("Energy: 5–9"), or null
 * when it holds nothing. An option the filter no longer offers reads as its
 * raw value.
 */
export function filterSummary(
  config: FilterColumnConfig,
  value: string | null
): string | null {
  return value ? filterControl(config).summary(config, value) : null;
}

/** A column's filter on the desktop toolbar, in whichever control it takes. */
export function FilterMenu(props: FilterControlProps<FilterColumnConfig>) {
  const control = filterControl(props.config);
  const Menu = control.Menu;
  return <Menu {...props} />;
}
