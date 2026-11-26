import type { z } from "zod";

/**
 * Where a value can be stored. A key's `scopes` lists the ones it accepts,
 * highest first, and that list is its cascade: user above project, project
 * above instance.
 */
export const SETTING_SCOPES = ["user", "project", "instance"] as const;

export type SettingScope = (typeof SETTING_SCOPES)[number];

/** The part of the hub a group is listed under. */
export type SettingSection = "personal" | "project" | "instance" | "devices";

/** The layer an effective value came from. `env` sits below every scope. */
export const SETTING_SOURCES = [...SETTING_SCOPES, "env", "default"] as const;

export type SettingSource = (typeof SETTING_SOURCES)[number];

/** The scopes a lock can be set at. */
export const SETTING_LOCK_SCOPES = [
  "project",
  "instance",
] as const satisfies readonly SettingScope[];

export type SettingLockScope = (typeof SETTING_LOCK_SCOPES)[number];

/**
 * How the hub edits a value. `custom` names a control the client registers
 * itself, for a value no generic control can enter.
 */
export type SettingControl =
  | { kind: "toggle" }
  | { kind: "text"; multiline?: boolean; placeholder?: string }
  | { kind: "colour" }
  | { kind: "select"; options: readonly { value: string; label: string }[] }
  | {
      kind: "multiselect";
      options: readonly { value: string; label: string }[];
    }
  | {
      kind: "number";
      min?: number;
      max?: number;
      step?: number;
      unit?: string;
      /** What an empty field means, for a key whose schema takes `null`. */
      placeholder?: string;
    }
  | { kind: "slider"; min: number; max: number; step: number; unit?: string }
  | {
      kind: "duration";
      unit: "s" | "min" | "h" | "d";
      min?: number;
      max?: number;
      /** What an empty field means, for a key whose schema takes `null`. */
      placeholder?: string;
    }
  | { kind: "list"; item: "text" | "path" }
  | {
      kind: "custom";
      component: string;
      /** The items a custom control lists, where it lists the app's own. */
      options?: readonly { value: string; label: string }[];
    };

/** A heading in the hub that settings are listed under. */
export interface SettingGroup {
  /** The first segment of every key in the group; never contains a dot. */
  readonly id: string;
  readonly section: SettingSection;
  readonly label: string;
  readonly description?: string;
  /** Sorts groups within a section, lowest first; ties fall back to `id`. */
  readonly order: number;
  /**
   * Tuning most instances never touch: the hub shows the group folded under
   * its head until it is opened, with a way to reset every key in it at once.
   */
  readonly advanced?: boolean;
}

/** The first segment of a key: `"editor"` for `"editor.rhymePrefix"`. */
type GroupOf<K extends string> = K extends `${infer G}.${string}` ? G : never;

/**
 * Everything the apps know about one setting. `V` is the value's type and `K`
 * its key, kept literal so the registry can type every value by its key.
 */
export interface SettingDefinition<
  V = unknown,
  K extends `${string}.${string}` = `${string}.${string}`,
> {
  /** `<group>.<name>`; the first segment is the group's id. */
  readonly key: K;
  readonly group: GroupOf<K>;
  readonly label: string;
  readonly description: string;
  /** Extra words the hub's search matches besides the label and description. */
  readonly keywords: readonly string[];
  /** The scopes the key accepts, highest first: the order the resolver walks. */
  readonly scopes: readonly SettingScope[];
  /**
   * Validates a stored value. It carries no `.default()`: zod fills an absent
   * key from a default nested in `.optional()`, which would turn "not set"
   * into a stored value. The default lives in `default`.
   */
  readonly schema: z.ZodType<V>;
  readonly default: V;
  readonly control: SettingControl;
  /** The lowest project role that may write the key at project scope. */
  readonly minRole?: "viewer" | "editor" | "admin" | "owner";
  /**
   * Who receives the key: `public` also signed-out pages, `all` every member,
   * `admin` instance admins only.
   */
  readonly audience: "public" | "all" | "admin";
  /** The running process reads the value once, so a change waits for a restart. */
  readonly restartRequired?: boolean;
  /** Whether a project or instance lock may pin the key; locks apply unless this is `false`. */
  readonly lockable?: boolean;
  /**
   * Mirrors the value onto `<html>`, as an attribute or as an inline style's
   * CSS custom property; `null` leaves it off.
   */
  readonly document?:
    | { readonly attribute: string; value(v: V): string | null }
    | { readonly property: string; value(v: V): string | null };
}

/** One key's effective value and where it came from. */
export type Resolved<V> = {
  value: V;
  source: SettingSource;
  /** The scope whose lock pinned the value; absent when nothing locks it. */
  lockedBy?: SettingLockScope;
  /** Scopes holding a value the schema rejects, which the cascade skipped. */
  invalid?: SettingScope[];
};
