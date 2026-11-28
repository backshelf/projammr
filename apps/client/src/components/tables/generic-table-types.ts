import type { PlaybackSubject } from "@/components/music-player/use-playback";
import type { GroupSummary } from "@/components/tables/group-sections";
import type { BulkSelection } from "@/entities/api";
import type { FieldConfig, FieldKindName, FieldValue } from "@/fields/types";
import type { Icon } from "@tabler/icons-react";
import type { RowData } from "@tanstack/react-table";
import type {
  CustomField,
  Facets,
  Label,
  MoveReport,
  PriorityLevel,
  SavedView,
  Status,
  TableEntityKind,
} from "@workspace/api/api";
import type { TableStateSource } from "@/components/tables/DataTable";
import type { DeleteKind } from "@/lib/policies/shell";
import type { TableSearchParams } from "@/lib/table-params";
import type { DataTableColumns } from "@workspace/ui/lib/table-config";
import type { ReactNode } from "react";

import type { RowCardChild, RowCardPlay } from "./cards/row-card-model";
import type { NewRowConfig } from "./DraftRow";
import type { PeekRow } from "./PeekPanel";

/**
 * A value a cell edit saves: what an editor produces, or a checkbox's state.
 * The same set as a field kind's `FieldValue`, which is what produces it — the
 * `list` kind saves a `string[]`, so the two must not drift apart.
 */
export type CellValue = FieldValue;

/**
 * What a table action reports back: a message to toast, and on success an
 * optional `undo` that reverses it and reports in turn.
 */
export type TableActionResult =
  | { ok: true; message: string; undo?: () => Promise<TableActionResult> }
  | { ok: false; message: string };

/** A row and bulk operation a table kind declares for itself. */
export type TableAction<TData> = {
  id: string;
  label: string;
  icon?: Icon;
  /** Offered on a target when at least one of its loaded rows passes. */
  offered: (row: TData) => boolean;
  run: (selection: BulkSelection) => Promise<TableActionResult>;
};

/**
 * App-level editability config for a column: the field kind that parses,
 * formats and enters its cells, and that kind's config. A `status` column
 * needs `statuses`; a `select` column needs `options`.
 */
export type EditableCellConfig = { type: FieldKindName } & FieldConfig;

/** Saved-views wiring for the toolbar picker. */
export type SavedViewsConfig = {
  views: SavedView[];
  /** The signed-in caller's id, for telling their own views from shared ones. Empty when unreadable. */
  me: string;
  /** Persists the current view under a name (creates or overwrites). */
  onSave: (name: string, query: string) => Promise<boolean>;
  onDelete: (viewId: number) => Promise<boolean>;
  /** Shares or unshares a view the caller owns. */
  onShare: (viewId: number, shared: boolean) => Promise<boolean>;
  /**
   * This project and kind's default saved view, from `tables.defaultSavedView`.
   * `null` when unset, or when the id it names is not among `views` (a stale
   * default is cleared client-side rather than shown as one).
   */
  defaultViewId: number | null;
  /** Makes a view this project and kind's default. */
  onSetDefault: (viewId: number) => Promise<boolean>;
  /** Clears this project and kind's default. */
  onClearDefault: (viewId: number) => Promise<boolean>;
};

/** One value a choice filter offers. */
type FilterOption = { value: string; label: string };

type FilterColumnBase = {
  /** The column id this filter belongs to (for the menu label). */
  id: string;
  label: string;
  /** Query-string key the server reads (`status`, `daw`, `explicit`, `cf_<id>`). */
  param: string;
};

/**
 * A filter picked from `options`: one value, or with `multiple` any set of
 * them, sent comma-separated as the server reads a membership filter. Each
 * option shows its live count from `facets[param]` unless `counted` is false,
 * for a filter the server keeps no counts for.
 */
export type ChoiceFilterConfig = FilterColumnBase & {
  control?: "choice";
  /** Selectable values. `value` is compared against the stringified facet key. */
  options: FilterOption[];
  multiple?: boolean;
  /**
   * With `multiple`, the trigger names every chosen option, in `options`
   * order, instead of the first and a count.
   */
  listed?: boolean;
  counted?: boolean;
};

/**
 * A range with either end open, sent as `<from>..<to>`; `input` is the field
 * kind each end is typed and checked with.
 */
export type RangeFilterConfig = FilterColumnBase & {
  control: "range";
  input: "number" | "date";
};

/** Text the column's value must contain, ignoring case, sent as typed. */
export type TextFilterConfig = FilterColumnBase & { control: "text" };

/** One filterable column, backed by a server query param. */
export type FilterColumnConfig =
  ChoiceFilterConfig | RangeFilterConfig | TextFilterConfig;

/**
 * A quick filter pill shown above the table toolbar (for example `All`,
 * `Unassigned`, `Not in dit` on the sessions list). Selecting a preset clears
 * every other preset's params and sets its own filter params.
 */
export type FilterPreset = {
  id: string;
  label: string;
  params: Record<string, string>;
};

/**
 * The expandable hierarchy: a row's children are a different entity (a
 * track's sessions, a collection's tracks) drawn on the parent's grid. Each
 * child cell is rendered by the entry for the parent column it sits under, so
 * the parent's own columns never see a child row. A column with no entry is
 * empty on a child row.
 */
export type SubRowsConfig<TData, TChild> = {
  getRows: (row: TData) => TChild[] | undefined;
  cells: Record<string, (child: TChild) => ReactNode>;
  /**
   * Fired the first time a row is expanded, for hierarchies whose children
   * are loaded on demand. `getRows` stays pure: this is what fetches the rows
   * it will then read. Fired again for every expanded row when `data` is
   * replaced, so a refetched page does not leave stale children open.
   */
  onExpand?: (row: TData) => void;
};

/** One page of server-paginated rows, as `serverPage.load` resolves it. */
export type PageResult<TData> = {
  rows: TData[];
  rowCount: number;
  pageSize: number;
};

export interface DataTableProps<TData extends RowData, TChild = never> {
  data: TData[];
  columns: DataTableColumns<TData>;
  emptyText?: string;
  /** Map of column ID → editable cell config. Supersedes column meta */
  editableCells?: Record<string, EditableCellConfig>;
  /**
   * Persists a cell edit. Returns whether the save succeeded so the table can
   * roll its optimistic update back on failure.
   */
  onCellSave?: (
    rowId: number,
    field: string,
    value: CellValue
  ) => Promise<boolean>;
  /**
   * Inline creation. When set, a `+ Add …` toggle under the grid opens a
   * draft row at the bottom of the table body: an editor in each column named by `newRow.fields`, a
   * create button beside the last one. Available on any table — the config
   * declares which columns are inputs, which are required, and how a row is
   * persisted.
   */
  newRow?: NewRowConfig;
  /**
   * Column IDs that accept keyboard navigation and spreadsheet paste. A cell in
   * one of these columns is selectable; every other column is skipped by the
   * arrow keys and excluded from a copy/paste rectangle. Defaults to the set of
   * columns present in `editableCells`.
   */
  navigableColumns?: string[];
  /**
   * When set, the server pages the rows: `data` is page 1 and `rowCount` is the
   * total matching rows, and the table loads further pages through `load`. For
   * a table whose state travels in the URL the server also owns filtering and
   * sorting: the table's own filter and sort row models are bypassed, and
   * search / sort changes navigate (RSC refetch) rather than only rewriting
   * the URL.
   *
   * Consequences of server pages: any client-side facet counts would describe
   * only the loaded rows, and a shift-click selection range cannot span rows
   * that are not loaded.
   *
   * `selectAllMatching` offers the "select all N" escalation, which hands
   * `onBulkDelete` a `{ all: true }` selection carrying filter params instead
   * of ids. Default `true`; pass `false` where the bulk action takes ids only,
   * or the escalated selection resolves to nothing.
   */
  serverPage?: {
    rowCount: number;
    /** Fetches one page of rows for `view`, 1-indexed. */
    load: (page: number, view: TableSearchParams) => Promise<PageResult<TData>>;
    selectAllMatching?: boolean;
    /**
     * Params the table's scope pins, which `load` sends but the URL's filter
     * params do not hold. The "select all N" selection carries them after the
     * filter params, so the scope wins, as it does in the page query.
     */
    scopeParams?: Record<string, string>;
  };
  /**
   * Server-side per-column filters. Each entry drives a dropdown in the toolbar
   * whose options carry live counts from `facets[param]`. Selecting a value
   * sets the `param` query string key the server reads; the current page
   * refetches. Only meaningful alongside `serverPage`.
   */
  filterColumns?: FilterColumnConfig[];
  /** Quick single-click filter preset pills rendered above the toolbar. */
  filterPresets?: FilterPreset[];
  /**
   * Faceted option counts from the server, keyed by filter param then by
   * stringified option value. Feeds the counts shown next to each filter
   * option ("In Progress · 7"). Computed against the full matching set, so the
   * numbers stay correct under server pagination.
   */
  facets?: Facets;
  /**
   * Column IDs hidden by default. A user can still reveal them from the column
   * menu; the choice persists in the URL. An ID absent here is visible.
   */
  initiallyHiddenColumns?: string[];
  /**
   * Turns on the leading checkbox column, shift-range selection, and the
   * floating action bar. The bar shows only the actions whose handler is
   * supplied. Selection is transient (not mirrored to the URL).
   */
  enableSelection?: boolean;
  /** Singular noun for the action bar ("3 tracks selected"). */
  entityLabel?: string;
  /** Statuses offered by the bar's "Set status" action. */
  bulkStatuses?: Status[];
  /** Collections offered by the bar's "Add to collection" action. */
  bulkCollections?: { id: number; title: string }[];
  /** The project's labels, offered by the bar's "Set labels" action. */
  bulkLabels?: Label[];
  /** The project's priority scale, offered by the bar's "Priority" action. */
  bulkPriorityLevels?: PriorityLevel[];
  /** The project's custom fields for the rows' kind, offered by the bar's "Set field…". */
  bulkFields?: CustomField[];
  /**
   * Applies one field patch to the selected rows. `selection` is either the
   * explicit id list or the "all matching the current filter" flag (with the
   * active filter params) once the user opts into selecting past the page.
   */
  onBulkPatch?: (
    selection: BulkSelection,
    patch: Record<string, unknown>
  ) => Promise<{ ok: boolean; count?: number }>;
  /** Adds the selected rows (tracks) to a collection. */
  onBulkAddToCollection?: (
    collectionId: number,
    trackIds: number[]
  ) => Promise<{ ok: boolean; count?: number }>;
  /** Adds and removes labels across the selected rows. */
  onBulkSetLabels?: (
    selection: BulkSelection,
    labels: { add: number[]; remove: number[] }
  ) => Promise<{ ok: boolean; count?: number }>;
  /**
   * Moves the selected rows to another project, reporting how many moved and
   * the priority levels that fell back to the destination's default.
   */
  onBulkMove?: (
    selection: BulkSelection,
    targetProjectId: number
  ) => Promise<{ ok: boolean; count?: number } & Partial<MoveReport>>;
  /**
   * Deletes the selected rows. The bar handles the single confirm + toast.
   * `selection` takes the same two forms as `onBulkPatch`'s, so "all N
   * matching" deletes the whole filtered set rather than the visible page.
   */
  onBulkDelete?: (
    selection: BulkSelection
  ) => Promise<{ ok: boolean; deleted?: number }>;
  /**
   * What a deleted row is, which says whether its delete asks first. Absent
   * for a table whose rows are never deleted from it (the repositories table).
   */
  deleteKind?: DeleteKind;
  /** The actions the table's kind declares; a viewer gets none. */
  actions?: TableAction<TData>[];
  /**
   * The keys rows can be grouped by. Selecting one from the "Group by" menu
   * sets the `group` query param the server reads; the server returns a bounded
   * preview of every group plus a `serverGroups` summary. The table draws a
   * section header before each group's rows. `filterParam`, when set, is the
   * server filter param that narrows to one group's value — a section with more
   * rows than the preview then links to the ungrouped list filtered to it. The
   * grouping choice is part of a saved view.
   */
  groupByOptions?: { id: string; label: string; filterParam?: string }[];
  /**
   * The server's summary of every group in the full filtered set — key, header
   * label, and cross-page count. Drives the section headers; a group split
   * across a page boundary still shows its real total.
   */
  serverGroups?: GroupSummary[];
  /**
   * A row's group key for the active grouping (`groupKey` is the `group` param
   * value — `"status"`, `"priority"`, `"daw"`, …). Must match the `key` the
   * server puts in `serverGroups` (`String(row.status?.id)`, `String(row.priority.id)`, …).
   * `null` for the "no value" bucket. Only read when a `group` param is active.
   */
  getRowGroupKey?: (row: TData, groupKey: string) => string | string[] | null;
  /** The expandable hierarchy of child rows under each row. */
  subRows?: SubRowsConfig<TData, TChild>;
  /** Named saved views for this table: the picker plus save/delete handlers. */
  savedViews?: SavedViewsConfig;
  /**
   * Row detail in a side panel instead of a navigation. Clicking a row opens
   * it over the table, so scroll position, filters and page survive; the open
   * row travels in the `peek` query param, making it linkable and closable
   * with the back button.
   *
   * `toPeekRow` maps a row to the panel's fields and `href` is its full page.
   * `titleField` names the row field a rename writes, which the panel cannot
   * know: the identity field is `title` on some entities and `name` on others.
   */
  peek?: {
    toPeekRow: (row: TData) => PeekRow;
    href: (row: TData) => string;
    titleField: string;
    /** Mirrors the open row into the `peek` query param. */
    inUrl?: boolean;
  };
  /**
   * Below the phone breakpoint the rows render as a stacked list instead of a
   * grid, because a table of real columns cannot be read at that width. The
   * card comes from `peek.toPeekRow` — title, subtitle, image, status,
   * priority — and `keyFields` names which of that row's `fields` appear on
   * the card, in the order given, at most two. Tapping a card opens
   * `peek.href`; the row's actions are behind a long press.
   *
   * Only meaningful alongside `peek`, which is what gives a row both its card
   * projection and its page.
   */
  cards?: {
    keyFields?: string[];
    /**
     * The row as something the player can take. A card with one turns its
     * artwork into a play control and offers playback in its action sheet;
     * a table whose rows are not audio leaves it out.
     */
    play?: (row: TData) => RowCardPlay;
    /**
     * A child row as one line of the card's disclosure. `subRows.cells` draws
     * a child against the parent's columns, which a list of cards does not
     * have, so the hierarchy only reaches a card through this.
     */
    childCard?: (child: TChild) => RowCardChild;
  };
  /**
   * Per-row actions: a bar that appears on hover in a cell pinned to the
   * viewport's right edge, and the same operations on right-click. Status,
   * collection and delete actions run through the same handlers the bulk bar
   * uses, so a one-row action and a many-row one take identical paths.
   *
   * Right-clicking a row inside the current selection targets the whole
   * selection; right-clicking outside it targets that row alone.
   */
  /**
   * Lets a row be moved into another project. `hrefInProject` is where the row
   * lives once it has moved — the app follows it there, because the URL it was
   * listed under belongs to the project it left.
   */
  moveToProject?: {
    kind: TableEntityKind;
    /** The project being listed, which is the one destination not offered. */
    projectId: number;
    hrefInProject: (row: TData, projectId: number) => string;
  };
  rowActions?: {
    /** Copies this row's full-page URL. Omit to hide "Copy link". */
    copyHref?: (row: TData) => string;
    /** Deletes one row. The bulk path handles a multi-row target. */
    onDelete?: (id: number) => Promise<{ ok: boolean }>;
    /** How a row is named in a confirmation — its title. */
    label?: (row: TData) => string;
    /** Playback subject offered at the top of the row's unified action menu. */
    play?: (row: TData) => PlaybackSubject;
  };
  /**
   * Where a row's colour comes from. The theme itself is achromatic, so the
   * only saturated thing in the grid is a record's status — which identifies
   * the row rather than decorating it.
   *
   * `accentHex` tints the hover action plate; omit it to leave the plate
   * neutral.
   */
  rowAccent?: {
    accentHex?: (row: TData) => string | null | undefined;
  };
  /**
   * Track reordering within a scoped collection. Provided for editors on
   * collection-scoped track tables; gated by `canEdit` inside `DataTable`.
   */
  reorder?: {
    onMove: (rowId: number, trackNumber: number) => Promise<boolean>;
  };
  /**
   * Identity column to pin while the grid scrolls sideways. The table keeps
   * its real columns at every width, so on a narrow viewport this is the one
   * column that must stay put for a row to remain identifiable.
   */
  pinnedColumnId?: string;
  /**
   * The view state, built with `useTableUrlState`. Given, the table owns the
   * page URL: its state travels there, and with a `serverPage` the server
   * filters, sorts and pages its rows. Absent, the table keeps the same state
   * in React alone.
   */
  urlState?: TableStateSource;
  /**
   * `"page"` claims the table's hotkey scope from mount, for the one table
   * that is the page; `"focus"` claims it only while the pointer or focus is
   * in the grid.
   */
  hotkeys?: "page" | "focus";
  /** The parts, in the order they render. */
  children: ReactNode;
}
