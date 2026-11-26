import dynamic from "next/dynamic";
import type { CustomSettingControl } from "../types";
import { DeleteConfirmsControl } from "./delete-confirms";
import { ImageControl } from "./ImageControl";
import { KeybindingMapControl } from "./keybinding-map";
import { LabCompressorControl } from "./lab-compressor";
import { LabEqControl } from "./lab-eq";
import { LabPitchRangeControl } from "./lab-pitch-range";
import { LabReverbControl } from "./lab-reverb";
import { LabSpeedRangeControl } from "./lab-speed-range";
import { OrderedListControl } from "./ordered-list";
import { PaletteAliasesControl } from "./palette-aliases";
import { ProjectPickerControl } from "./project-picker";
import { TableDefaultViewsControl } from "./table-default-views";

// The table controls list a kind's columns through `entityTable(kind)`, which
// brings every entity table and its actions with it: loaded when a Tables row
// renders, so the rest of the hub (and its tests) never pull that chain in.
const TableColumnsControl = dynamic(() =>
  import("./table-columns").then((mod) => mod.TableColumnsControl)
);
const TableGroupingControl = dynamic(() =>
  import("./table-grouping").then((mod) => mod.TableGroupingControl)
);
const TableSortControl = dynamic(() =>
  import("./table-sort").then((mod) => mod.TableSortControl)
);

// project-status and project-labels call a "use server" action, which pulls
// in `lib/server-api.ts`'s `import "server-only"`: loaded when a row using
// one renders, so the rest of the hub (and its tests) never pull that in.
const ProjectLabelsControl = dynamic(() =>
  import("./project-labels").then((mod) => mod.ProjectLabelsControl)
);
const ProjectStatusControl = dynamic(() =>
  import("./project-status").then((mod) => mod.ProjectStatusControl)
);

/**
 * The controls `custom` settings name, by the `component` their definition
 * gives: one import and one line per control, alphabetical.
 */
export const CUSTOM_CONTROLS: Readonly<Record<string, CustomSettingControl>> = {
  "delete-confirms": DeleteConfirmsControl,
  image: ImageControl,
  "keybinding-map": KeybindingMapControl,
  "lab-compressor": LabCompressorControl,
  "lab-eq": LabEqControl,
  "lab-pitch-range": LabPitchRangeControl,
  "lab-reverb": LabReverbControl,
  "lab-speed-range": LabSpeedRangeControl,
  "ordered-list": OrderedListControl,
  "palette-aliases": PaletteAliasesControl,
  "project-labels": ProjectLabelsControl,
  "project-picker": ProjectPickerControl,
  "project-status": ProjectStatusControl,
  "table-columns": TableColumnsControl,
  "table-default-views": TableDefaultViewsControl,
  "table-grouping": TableGroupingControl,
  "table-sort": TableSortControl,
};
