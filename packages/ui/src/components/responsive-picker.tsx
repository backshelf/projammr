"use client";

import { IconCheck, IconPlus, IconSearch, IconX } from "@tabler/icons-react";
import { useHaptics } from "@workspace/ui/components/haptics";
import { Input } from "@workspace/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@workspace/ui/components/sheet";
import { useIsMobile } from "@workspace/ui/hooks/use-mobile";
import {
  composeRender,
  OVERLAY_DESC,
  OVERLAY_TITLE,
} from "@workspace/ui/lib/overlay";
import { cn } from "@workspace/ui/lib/utils";
import * as React from "react";

export interface ResponsivePickerOption {
  value: string;
  label: React.ReactNode;
  /** Plain text matched during search when `label` is a React element. */
  searchText?: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  selected?: boolean;
  disabled?: boolean;
}

interface ResponsivePickerContextValue {
  isMobile: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  closeOnSelect: boolean;
}

const ResponsivePickerContext =
  React.createContext<ResponsivePickerContextValue | null>(null);

function useResponsivePicker(component: string) {
  const ctx = React.use(ResponsivePickerContext);
  if (!ctx) {
    throw new Error(`${component} must sit inside ResponsivePicker`);
  }
  return ctx;
}

export interface ResponsivePickerProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Accessible & mobile sheet title. Defaults to "Choose an option". */
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Convenience trigger element (wrapped via `asChild`). Alternatively, pass
   *  `<ResponsivePickerTrigger>` inside `children`. */
  trigger?: React.ReactNode;
  /** Structured options for the built-in searchable picker body. Omit when
   *  composing `<ResponsivePickerContent>` manually in `children`. */
  options?: readonly ResponsivePickerOption[];
  /** Selected value or values, matched against `option.value`. */
  value?: string | readonly string[];
  onSelect?: (value: string) => void;
  closeOnSelect?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  /** Focuses the search input on desktop open; never auto-focuses on mobile
   *  so opening a sheet never summons the virtual keyboard unexpectedly. */
  autoFocusSearch?: boolean;
  emptyLabel?: React.ReactNode;
  createLabel?: (query: string) => React.ReactNode;
  onCreate?: (query: string) => void;
  clearLabel?: React.ReactNode;
  onClear?: () => void;
  showClear?: boolean;
  footer?: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  className?: string;
  sheetClassName?: string;
  desktopClassName?: string;
  children?: React.ReactNode;
}

function optionText(option: ResponsivePickerOption): string {
  if (option.searchText !== undefined) return option.searchText;
  if (typeof option.label === "string" || typeof option.label === "number") {
    return String(option.label);
  }
  return option.value;
}

function isOptionSelected(
  option: ResponsivePickerOption,
  value: ResponsivePickerProps["value"]
): boolean {
  if (option.selected !== undefined) return option.selected;
  if (value === undefined) return false;
  return Array.isArray(value)
    ? value.includes(option.value)
    : value === option.value;
}

/**
 * Adaptive picker primitive: renders a swipeable `BottomSheet` below 768px
 * (`useIsMobile`) with 44px hairline rows and a 16px search field (preventing
 * iOS Safari auto-zoom), and a `Popover` on desktop.
 */
function ResponsivePicker({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  title = "Choose an option",
  description,
  trigger,
  options,
  value,
  onSelect,
  closeOnSelect = true,
  searchable = false,
  searchPlaceholder = "Filter…",
  searchValue: searchValueProp,
  onSearchChange,
  autoFocusSearch = true,
  emptyLabel = "No matching options.",
  createLabel,
  onCreate,
  clearLabel = "Clear selection",
  onClear,
  showClear,
  footer,
  align = "start",
  side,
  sideOffset,
  className,
  sheetClassName,
  desktopClassName,
  children,
}: ResponsivePickerProps) {
  const isMobile = useIsMobile();
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolledOpen;

  const [uncontrolledQuery, setUncontrolledQuery] = React.useState("");
  const query = searchValueProp ?? uncontrolledQuery;
  const setQuery = React.useCallback(
    (next: string) => {
      if (searchValueProp === undefined) setUncontrolledQuery(next);
      onSearchChange?.(next);
    },
    [onSearchChange, searchValueProp]
  );

  const setOpen = React.useCallback(
    (next: boolean) => {
      if (openProp === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
      if (!next && searchValueProp === undefined) {
        setUncontrolledQuery("");
      }
    },
    [onOpenChange, openProp, searchValueProp]
  );

  const ctx = React.useMemo<ResponsivePickerContextValue>(
    () => ({ isMobile, open, setOpen, closeOnSelect }),
    [closeOnSelect, isMobile, open, setOpen]
  );

  const body =
    options !== undefined ? (
      <ResponsivePickerBuiltInBody
        options={options}
        value={value}
        onSelect={onSelect}
        closeOnSelect={closeOnSelect}
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
        query={query}
        onQueryChange={setQuery}
        autoFocusSearch={autoFocusSearch}
        emptyLabel={emptyLabel}
        createLabel={createLabel}
        onCreate={onCreate}
        clearLabel={clearLabel}
        onClear={onClear}
        showClear={showClear ?? Boolean(onClear)}
        footer={footer}
      />
    ) : (
      children
    );

  const Root = isMobile ? Sheet : Popover;

  return (
    <ResponsivePickerContext value={ctx}>
      <Root open={open} onOpenChange={setOpen}>
        {trigger !== undefined && (
          <ResponsivePickerTrigger asChild>{trigger}</ResponsivePickerTrigger>
        )}
        {options !== undefined ? (
          <ResponsivePickerContent
            title={title}
            description={description}
            align={align}
            side={side}
            sideOffset={sideOffset}
            className={className}
            sheetClassName={sheetClassName}
            desktopClassName={desktopClassName}
          >
            {body}
          </ResponsivePickerContent>
        ) : (
          body
        )}
      </Root>
    </ResponsivePickerContext>
  );
}

function ResponsivePickerBuiltInBody({
  options,
  value,
  onSelect,
  closeOnSelect,
  searchable,
  searchPlaceholder,
  query,
  onQueryChange,
  autoFocusSearch,
  emptyLabel,
  createLabel,
  onCreate,
  clearLabel,
  onClear,
  showClear,
  footer,
}: {
  options: readonly ResponsivePickerOption[];
  value?: string | readonly string[];
  onSelect?: (value: string) => void;
  closeOnSelect: boolean;
  searchable: boolean;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  autoFocusSearch: boolean;
  emptyLabel: React.ReactNode;
  createLabel?: (query: string) => React.ReactNode;
  onCreate?: (query: string) => void;
  clearLabel: React.ReactNode;
  onClear?: () => void;
  showClear: boolean;
  footer?: React.ReactNode;
}) {
  const { setOpen } = useResponsivePicker("ResponsivePicker");
  const trimmed = query.trim();
  const needle = trimmed.toLowerCase();

  const filtered = React.useMemo(
    () =>
      needle
        ? options.filter((opt) =>
            optionText(opt).toLowerCase().includes(needle)
          )
        : options,
    [needle, options]
  );

  const exactMatch = React.useMemo(
    () =>
      trimmed !== "" &&
      options.some((opt) => optionText(opt).toLowerCase() === needle),
    [needle, options, trimmed]
  );

  const canCreate = Boolean(onCreate && trimmed && !exactMatch);

  return (
    <>
      {searchable && (
        <ResponsivePickerSearch
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={searchPlaceholder}
          autoFocus={autoFocusSearch}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canCreate) {
              e.preventDefault();
              onCreate?.(trimmed);
              onQueryChange("");
              if (closeOnSelect) setOpen(false);
            }
          }}
        />
      )}
      <ResponsivePickerList>
        {filtered.map((option) => {
          const selected = isOptionSelected(option, value);
          return (
            <ResponsivePickerItem
              key={option.value}
              selected={selected}
              disabled={option.disabled}
              icon={option.icon}
              description={option.description}
              onSelect={() => {
                onSelect?.(option.value);
              }}
            >
              {option.label}
            </ResponsivePickerItem>
          );
        })}
        {canCreate && (
          <ResponsivePickerCreate
            onSelect={() => {
              onCreate?.(trimmed);
              onQueryChange("");
              if (closeOnSelect) setOpen(false);
            }}
          >
            {createLabel ? createLabel(trimmed) : `Create “${trimmed}”`}
          </ResponsivePickerCreate>
        )}
        {filtered.length === 0 && !canCreate && (
          <ResponsivePickerEmpty>{emptyLabel}</ResponsivePickerEmpty>
        )}
      </ResponsivePickerList>
      {showClear && (
        <ResponsivePickerClear
          onSelect={() => {
            onClear?.();
            if (closeOnSelect) setOpen(false);
          }}
        >
          {clearLabel}
        </ResponsivePickerClear>
      )}
      {footer && <ResponsivePickerFooter>{footer}</ResponsivePickerFooter>}
    </>
  );
}

function ResponsivePickerTrigger({
  asChild,
  ...props
}: Omit<React.ComponentProps<typeof PopoverTrigger>, "handle" | "payload">) {
  const { isMobile } = useResponsivePicker("ResponsivePickerTrigger");
  const composed = composeRender({ asChild, ...props });
  if (isMobile) {
    return <SheetTrigger data-slot="responsive-picker-trigger" {...composed} />;
  }
  return <PopoverTrigger data-slot="responsive-picker-trigger" {...composed} />;
}

function ResponsivePickerContent({
  title = "Choose an option",
  description,
  align = "start",
  side,
  sideOffset = 6,
  className,
  sheetClassName,
  desktopClassName,
  children,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  className?: string;
  sheetClassName?: string;
  desktopClassName?: string;
  children: React.ReactNode;
}) {
  const { isMobile } = useResponsivePicker("ResponsivePickerContent");

  if (isMobile) {
    return (
      <SheetContent
        side="bottom"
        data-slot="responsive-picker-sheet"
        className={cn(
          "max-h-[85dvh] gap-0 overflow-hidden p-0",
          className,
          sheetClassName
        )}
      >
        <SheetHeader className="shrink-0 gap-1 border-b border-rule px-4 pt-3 pb-3">
          <SheetTitle className={OVERLAY_TITLE}>{title}</SheetTitle>
          {description && (
            <SheetDescription className={OVERLAY_DESC}>
              {description}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-3">
          {children}
        </div>
      </SheetContent>
    );
  }

  return (
    <PopoverContent
      align={align}
      side={side}
      sideOffset={sideOffset}
      data-slot="responsive-picker-popover"
      className={cn(
        "flex max-h-[min(24rem,70dvh)] w-64 flex-col gap-2 overflow-hidden p-2",
        className,
        desktopClassName
      )}
    >
      {children}
    </PopoverContent>
  );
}

function ResponsivePickerSearch({
  className,
  autoFocus = true,
  "aria-label": ariaLabel = "Filter options",
  ...props
}: React.ComponentProps<typeof Input>) {
  const { isMobile } = useResponsivePicker("ResponsivePickerSearch");
  return (
    <div
      data-slot="responsive-picker-search"
      className="relative flex shrink-0 items-center"
    >
      <IconSearch
        aria-hidden
        className="pointer-events-none absolute left-2.5 size-3.5 text-ink-faint"
      />
      <Input
        {...props}
        aria-label={ariaLabel}
        // Never auto-focus on phone so opening the sheet does not force the
        // virtual keyboard up before the user sees the options.
        autoFocus={autoFocus && !isMobile}
        className={cn(
          "pl-8 text-base md:text-small coarse:min-h-11 coarse:text-base",
          isMobile && "min-h-11 text-base md:text-base",
          className
        )}
      />
    </div>
  );
}

function ResponsivePickerList({
  className,
  onKeyDown,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      role="listbox"
      data-slot="responsive-picker-list"
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (
          event.key !== "ArrowDown" &&
          event.key !== "ArrowUp" &&
          event.key !== "Home" &&
          event.key !== "End"
        ) {
          return;
        }
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[data-slot="responsive-picker-item"]:not(:disabled):not([aria-disabled="true"])'
          )
        );
        if (items.length === 0) return;
        event.preventDefault();
        const activeIndex = items.findIndex(
          (item) => item === document.activeElement
        );
        let nextIndex: number;
        switch (event.key) {
          case "ArrowDown":
            nextIndex = activeIndex >= 0 ? (activeIndex + 1) % items.length : 0;
            break;
          case "ArrowUp":
            nextIndex =
              activeIndex >= 0
                ? (activeIndex - 1 + items.length) % items.length
                : items.length - 1;
            break;
          case "Home":
            nextIndex = 0;
            break;
          case "End":
            nextIndex = items.length - 1;
            break;
        }
        items[nextIndex]?.focus();
      }}
      className={cn(
        "flex min-h-0 flex-1 flex-col divide-y divide-rule overflow-y-auto overscroll-contain",
        className
      )}
      {...props}
    />
  );
}

function ResponsivePickerItem({
  selected = false,
  icon,
  description,
  onSelect,
  onClick,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "onSelect"> & {
  selected?: boolean;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  onSelect?: () => void;
}) {
  const { isMobile, setOpen, closeOnSelect } = useResponsivePicker(
    "ResponsivePickerItem"
  );
  const haptic = useHaptics();

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-slot="responsive-picker-item"
      data-selected={selected || undefined}
      onClick={(event) => {
        haptic();
        onClick?.(event);
        if (!event.defaultPrevented) {
          onSelect?.();
          if (closeOnSelect) setOpen(false);
        }
      }}
      className={cn(
        "flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-small text-ink motion-ink",
        "hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]",
        "focus-visible:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] focus-visible:outline-hidden",
        "disabled:pointer-events-none disabled:opacity-50",
        "coarse:min-h-11 coarse:text-body",
        isMobile && "min-h-11 text-body",
        className
      )}
      {...props}
    >
      {icon && (
        <span className="shrink-0 text-ink-soft [&_svg]:size-4">{icon}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {description && (
          <span className="block truncate text-micro text-ink-soft">
            {description}
          </span>
        )}
      </span>
      {selected && (
        <IconCheck aria-hidden className="ml-auto size-4 shrink-0 text-art" />
      )}
    </button>
  );
}

function ResponsivePickerEmpty({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="responsive-picker-empty"
      className={cn(
        "px-2.5 py-4 text-center text-small text-ink-soft",
        className
      )}
      {...props}
    />
  );
}

function ResponsivePickerCreate({
  onSelect,
  onClick,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "onSelect"> & {
  onSelect?: () => void;
}) {
  const { isMobile } = useResponsivePicker("ResponsivePickerCreate");
  const haptic = useHaptics();

  return (
    <button
      type="button"
      data-slot="responsive-picker-create"
      onClick={(event) => {
        haptic();
        onClick?.(event);
        if (!event.defaultPrevented) onSelect?.();
      }}
      className={cn(
        "flex w-full items-center gap-2 px-2.5 py-2 text-left text-small text-art motion-ink",
        "hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]",
        "focus-visible:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] focus-visible:outline-hidden",
        "disabled:pointer-events-none disabled:opacity-50",
        "coarse:min-h-11 coarse:text-body",
        isMobile && "min-h-11 text-body",
        className
      )}
      {...props}
    >
      <IconPlus aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

function ResponsivePickerClear({
  onSelect,
  onClick,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"button">, "onSelect"> & {
  onSelect?: () => void;
}) {
  const { isMobile } = useResponsivePicker("ResponsivePickerClear");
  const haptic = useHaptics();

  return (
    <button
      type="button"
      data-slot="responsive-picker-clear"
      onClick={(event) => {
        haptic();
        onClick?.(event);
        if (!event.defaultPrevented) onSelect?.();
      }}
      className={cn(
        "flex w-full shrink-0 items-center gap-2 border-t border-rule px-2.5 py-2 text-left text-small text-ink-soft motion-ink",
        "hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)] hover:text-ink",
        "focus-visible:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] focus-visible:outline-hidden",
        "disabled:pointer-events-none disabled:opacity-50",
        "coarse:min-h-11 coarse:text-body",
        isMobile && "min-h-11 text-body",
        className
      )}
      {...props}
    >
      <IconX aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  );
}

function ResponsivePickerFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="responsive-picker-footer"
      className={cn(
        "shrink-0 border-t border-rule pt-2 text-small text-ink-soft",
        className
      )}
      {...props}
    />
  );
}

export {
  ResponsivePicker,
  ResponsivePickerClear,
  ResponsivePickerContent,
  ResponsivePickerCreate,
  ResponsivePickerEmpty,
  ResponsivePickerFooter,
  ResponsivePickerItem,
  ResponsivePickerList,
  ResponsivePickerSearch,
  ResponsivePickerTrigger,
};
