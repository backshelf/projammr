/**
 * The meaning of a stored track-audio analysis: the layout of every
 * measurement `AnalysisSession` produces, from the sample rate it decodes at
 * to the band table `SPECTRUM_LAYOUT` names. A row's own `analysisVersion`
 * column trails this whenever it changes, which is what makes a row
 * outstanding and due for another decode.
 *
 * Bump this for any change to what a stored measurement means: a different
 * decode sample rate or channel count, a different spectrum band table,
 * different rounding, or a new column the funnel starts writing.
 */
export const ANALYSIS_VERSION = 4;
