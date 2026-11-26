/**
 * The column widths every rack module shares, so RackEq's, RackComp's and
 * RackReverb's rows line up under the Rack section instead of each module
 * picking its own: one width for a row's leading label, and one for the
 * numeric reading a row trails with — wide enough for the longest figure any
 * module prints ("100.0ms").
 */
export const RACK_LABEL_WIDTH = "w-20";
export const RACK_VALUE_WIDTH = "w-16";
/** Every module's on/off pill, one width whatever its label, so the EQ pill
 *  (alone in its column, where it would otherwise stretch) matches the Comp
 *  and Verb pills beside their meter and presets. */
export const RACK_PILL_WIDTH = "w-16 justify-center";
