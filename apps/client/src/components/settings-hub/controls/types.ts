import type { SettingControl, SettingDefinition } from "@workspace/settings";
import type { ComponentType } from "react";

/** Every kind of control a setting can declare. */
export type SettingControlKind = SettingControl["kind"];

/** The declaration of one kind of control, with its options. */
export type ControlOf<K extends SettingControlKind> = Extract<
  SettingControl,
  { kind: K }
>;

/**
 * What a control edits a setting through. It shows `value` and hands every
 * change to `onChange` as the reader makes it; the row decides when the
 * change is saved, so a control never debounces or saves on its own.
 *
 * The row labels the control by `id`: its label is `labelIdOf(id)` (the
 * `for` of a `<label>`, so a control that is not a single labelable element
 * names itself with `aria-labelledby`), and `describedByOf(id)` lists the
 * description and any error for `aria-describedby`.
 */
export type SettingControlProps<
  V = unknown,
  C extends SettingControl = SettingControl,
> = {
  definition: SettingDefinition<V> & { readonly control: C };
  value: V;
  onChange: (value: V) => void;
  disabled: boolean;
  id: string;
  /** Whether the row is showing an error for the last change, which a
   *  control with a single field marks with `aria-invalid`. */
  invalid?: boolean;
};

/** The value each kind of control edits; a numeric one may be `null` where its setting takes it. */
type ControlValues = {
  colour: string;
  custom: unknown;
  duration: number | null;
  list: readonly string[];
  multiselect: readonly string[];
  number: number | null;
  select: string;
  slider: number;
  text: string;
  toggle: boolean;
};

/** The component for one kind of control. */
export type SettingControlComponent<K extends SettingControlKind> =
  ComponentType<SettingControlProps<ControlValues[K], ControlOf<K>>>;

/**
 * A control a `custom` setting names. It knows its own setting's value, so it
 * takes `value` as `unknown` and reads it through `definition.schema`.
 */
export type CustomSettingControl = ComponentType<
  SettingControlProps<unknown, ControlOf<"custom">>
>;

export const labelIdOf = (id: string) => `${id}-label`;
export const descriptionIdOf = (id: string) => `${id}-description`;
export const errorIdOf = (id: string) => `${id}-error`;

/** The `aria-describedby` of a control: the row's description, and its error while it shows one. */
export const describedByOf = (id: string) =>
  `${descriptionIdOf(id)} ${errorIdOf(id)}`;
