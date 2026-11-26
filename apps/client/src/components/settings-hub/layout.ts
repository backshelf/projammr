import { roleSatisfies } from "@/lib/roles";
import { settingsHref } from "@/lib/settings/href";
import type { SettingsWriteScope } from "@/lib/settings/provider";
import {
  GROUPS,
  SETTINGS,
  type RegisteredSetting,
  type SettingSection,
} from "@workspace/settings";
import { memberDefaultsGroup } from "./member-defaults";
import type { HubPane, HubProject } from "./panes/types";
import type { HubRowRef } from "./types";

/** A group of rows in a section: one the registry declares, or the generated member defaults. */
export type HubGroupEntry = {
  kind: "group";
  id: string;
  label: string;
  description?: string;
  order: number;
  /** Folded under its head until opened, with a reset for all its rows. */
  advanced?: boolean;
  rows: HubRowRef[];
};

/** A pane in a section, from `HUB_PANES`. */
type HubPaneEntry = {
  kind: "pane";
  id: string;
  label: string;
  order: number;
};

export type HubEntry = (HubGroupEntry | HubPaneEntry) & { href: string };

/** One section of the hub as the caller sees it. */
export type HubSectionView = {
  id: SettingSection;
  label: string;
  /** A line under the label: the project a Project section is for. */
  detail?: string;
  /** The section page's title and the line under it. */
  heading: SectionHeading;
  href: string;
  /** Its groups and panes, in `order`. */
  entries: HubEntry[];
  /**
   * Whether every entry shows on the section's one page. The Devices URL has
   * no segment for a group or a pane, so its entries stack there; elsewhere a
   * pane is a page of its own.
   */
  stacked: boolean;
};

/** A row the hub's search can find, and where it lives. */
export type HubSearchEntry = HubRowRef & {
  section: string;
  group: string;
  /** The group's page in its section. */
  groupHref: string;
};

/** What decides the hub's shape for one caller. */
export type HubContext = {
  /** The keys the hub read returned: every setting the caller receives. */
  visible: ReadonlySet<string>;
  isAdmin: boolean;
  /** The project the page is resolved with: the URL's in the Project section, else the current one. */
  project: HubProject | null;
  panes: readonly Omit<HubPane, "Content">[];
};

type SectionHeading = { title: string; lede: string };

type SectionSpec = {
  id: SettingSection;
  label: string;
  heading(context: HubContext): SectionHeading;
  /** The scope the section's rows write; absent where the hub writes none. */
  scope?: SettingsWriteScope;
  /** The description of the section's member defaults, for a section that generates them. */
  memberDefaults?: string;
  stacked?: boolean;
  /** The line under the section's label in the nav. */
  detail?(context: HubContext): string | undefined;
  shown(context: HubContext): boolean;
  /** Whether the caller sees one of the section's panes. */
  sees(pane: Omit<HubPane, "Content">, context: HubContext): boolean;
};

const everyPane = () => true;

/** The four sections, in the order the nav lists them. */
const SECTIONS: readonly SectionSpec[] = [
  {
    id: "personal",
    label: "Personal",
    heading: ({ project }) => ({
      title: "Personal",
      lede: project
        ? `Yours, wherever you sign in, shown as they apply in ${project.name}.`
        : "Yours, wherever you sign in.",
    }),
    scope: "user",
    shown: () => true,
    sees: everyPane,
  },
  {
    id: "project",
    label: "Project",
    heading: ({ project }) => ({
      title: project?.name ?? "Project",
      lede: "What every member of this project shares.",
    }),
    scope: "project",
    memberDefaults:
      "What every member of this project starts with until they choose their own. Lock one to hold it for everyone here.",
    detail: ({ project }) => project?.name,
    shown: ({ project }) => project !== null,
    sees: (pane, { project }) =>
      project !== null &&
      (pane.minRole === undefined || roleSatisfies(project.role, pane.minRole)),
  },
  {
    id: "instance",
    label: "Instance",
    heading: () => ({
      title: "Instance",
      lede: "How this instance runs, and what every member starts with.",
    }),
    scope: "instance",
    memberDefaults:
      "What every member of this instance starts with until they, or their project, choose otherwise. Lock one to hold it for everyone.",
    shown: ({ isAdmin }) => isAdmin,
    sees: everyPane,
  },
  {
    id: "devices",
    label: "Devices",
    heading: () => ({
      title: "Devices",
      lede: "What stays with one browser, and the machines you use.",
    }),
    stacked: true,
    shown: () => true,
    sees: everyPane,
  },
];

const DEFINITIONS: readonly RegisteredSetting[] = Object.values(SETTINGS);

/** A declared group's rows at `scope`: its settings the caller receives that take a value there. */
function declaredGroup(
  group: (typeof GROUPS)[number],
  scope: SettingsWriteScope,
  visible: ReadonlySet<string>
): HubGroupEntry {
  return {
    kind: "group",
    id: group.id,
    label: group.label,
    ...(group.description === undefined
      ? {}
      : { description: group.description }),
    order: group.order,
    ...(group.advanced ? { advanced: true } : {}),
    rows: DEFINITIONS.filter(
      (definition) =>
        definition.group === group.id &&
        definition.scopes.includes(scope) &&
        visible.has(definition.key)
    ).map((definition) => ({ key: definition.key, scope })),
  };
}

/**
 * The groups the registry declares for `section`, in order, each with its
 * rows at `scope`; a group with no row there is left out.
 */
function declaredGroups(
  section: SettingSection,
  scope: SettingsWriteScope,
  visible: ReadonlySet<string>
): HubGroupEntry[] {
  return GROUPS.filter((group) => group.section === section)
    .map((group) => declaredGroup(group, scope, visible))
    .filter((group) => group.rows.length > 0)
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
}

/** Sorts the Instance section's project groups after Member defaults (order 1000). */
const INSTANCE_PROJECT_GROUP_OFFSET = 1000;

/**
 * Project keys with no instance-wide value: a status or label id belongs to one
 * project, and its control reads that project, which the Instance section lacks.
 */
const PER_PROJECT_KEYS: ReadonlySet<string> = new Set([
  "project-defaults.trackStatusId",
  "project-defaults.collectionStatusId",
  "project-defaults.labelIds",
]);

/** The Project section's groups as rows at `instance`, after Member defaults, without the per-project keys. */
function instanceProjectGroups(visible: ReadonlySet<string>): HubGroupEntry[] {
  const shared = new Set(
    [...visible].filter((key) => !PER_PROJECT_KEYS.has(key))
  );
  return declaredGroups("project", "instance", shared).map((group) => ({
    ...group,
    order: INSTANCE_PROJECT_GROUP_OFFSET + group.order,
  }));
}

function entriesOf(
  spec: SectionSpec,
  context: HubContext
): (HubGroupEntry | HubPaneEntry)[] {
  const { scope } = spec;
  const groups: HubGroupEntry[] =
    scope === undefined
      ? []
      : GROUPS.filter((group) => group.section === spec.id).map((group) =>
          declaredGroup(group, scope, context.visible)
        );
  if (scope !== undefined && spec.memberDefaults !== undefined) {
    groups.push(
      memberDefaultsGroup(scope, spec.memberDefaults, context.visible)
    );
  }
  const panes: HubPaneEntry[] = context.panes
    .filter((pane) => pane.section === spec.id && spec.sees(pane, context))
    .map(({ id, label, order }) => ({ kind: "pane", id, label, order }));

  if (spec.id === "instance") {
    groups.push(...instanceProjectGroups(context.visible));
  }
  const entries = [
    ...groups.filter((group) => group.rows.length > 0),
    ...panes,
  ].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

  const ids = new Set<string>();
  for (const { id } of entries) {
    if (ids.has(id)) {
      throw new Error(
        `The ${spec.id} settings section has two groups or panes called "${id}"`
      );
    }
    ids.add(id);
  }
  return entries;
}

/**
 * The hub as one caller sees it: the sections they may open, each with the
 * groups that hold a setting they receive and the panes their role sees, and
 * every row the search can find. A section the caller cannot open is not
 * here, so none of its rows are in the search either.
 */
export function hubLayout(context: HubContext): {
  sections: HubSectionView[];
  index: HubSearchEntry[];
} {
  const projectId = context.project?.id;
  const sections = SECTIONS.filter((spec) => spec.shown(context)).map(
    (spec): HubSectionView => {
      const section = spec.id;
      const view: HubSectionView = {
        id: section,
        label: spec.label,
        heading: spec.heading(context),
        href: settingsHref({ section, projectId }),
        entries: entriesOf(spec, context).map((entry) => ({
          ...entry,
          href: settingsHref({ section, projectId, group: entry.id }),
        })),
        stacked: spec.stacked === true,
      };
      const detail = spec.detail?.(context);
      if (detail !== undefined) view.detail = detail;
      return view;
    }
  );

  const index = sections.flatMap((section) =>
    section.entries.flatMap((entry) =>
      entry.kind === "group"
        ? entry.rows.map((row) => ({
            ...row,
            section: section.label,
            group: entry.label,
            groupHref: entry.href,
          }))
        : []
    )
  );

  return { sections, index };
}
