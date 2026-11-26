import { transitionFacet } from "./facet.js";

/** The set's time signature, as the DAW writes it ("6/8"). */
export const timeSignatureFacet = transitionFacet({
  id: "timeSignature",
  kind: "timeSignature",
  capability: "timeSignature",
  label: "Time signature",
  noun: "time sig",
  read: (meta) => meta.timeSignature,
});
