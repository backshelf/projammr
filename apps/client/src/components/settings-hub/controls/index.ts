import type { SettingDefinition } from "@workspace/settings";
import { createElement, type ComponentType } from "react";
import { ColourControl } from "./ColourControl";
import { CustomControl } from "./CustomControl";
import { DurationControl } from "./DurationControl";
import { ListControl } from "./ListControl";
import { MultiselectControl } from "./MultiselectControl";
import { NumberControl } from "./NumberControl";
import { SelectControl } from "./SelectControl";
import { SliderControl } from "./SliderControl";
import { TextControl } from "./TextControl";
import { ToggleControl } from "./ToggleControl";
import type {
  SettingControlComponent,
  SettingControlKind,
  SettingControlProps,
} from "./types";

export type { SettingControlProps } from "./types";

/** The control for each kind a setting can declare, one line each, alphabetical. */
export const SETTING_CONTROLS: {
  readonly [K in SettingControlKind]: SettingControlComponent<K>;
} = {
  colour: ColourControl,
  custom: CustomControl,
  duration: DurationControl,
  list: ListControl,
  multiselect: MultiselectControl,
  number: NumberControl,
  select: SelectControl,
  slider: SliderControl,
  text: TextControl,
  toggle: ToggleControl,
};

/**
 * The control a setting declares. Each component is typed for its own kind's
 * value, but a definition read by key no longer tells the compiler which kind
 * it is, so the lookup hands the component back taking any setting's props:
 * the definition's schema is what pairs its value with its control.
 */
export const controlFor = (
  definition: SettingDefinition
): ComponentType<SettingControlProps> =>
  SETTING_CONTROLS[
    definition.control.kind
  ] as unknown as ComponentType<SettingControlProps>;

/**
 * Renders the control its setting declares. Each kind's component is one
 * module-level constant, so the element keeps its identity (and its state)
 * across renders.
 */
export function SettingControl(props: SettingControlProps) {
  return createElement(controlFor(props.definition), props);
}
