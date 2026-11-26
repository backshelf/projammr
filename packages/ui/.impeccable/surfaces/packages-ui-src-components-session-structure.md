---
version: 1
slug: "packages-ui-src-components-session-structure"
primary_target: "packages/ui/src/components/session-structure"
related_targets: ["apps/client/src/modules/session","apps/web/src/components/marketing/SessionDiff.astro"]
---

Scope: the save diff card in `@workspace/ui` (`packages/ui/src/components/session-structure/`), rendered by the client's session page (STRUCTURE section: the latest save against the one before it), the client's session history page (the compare view, with its from/to pickers in the card's header), and the marketing site's landing hero and scanner page (`apps/web`, static HTML). Visitor mode: Operate in the client, Persuade proof on the site.

Audience and job: a producer checking what their last save did to a set, and a collaborator seeing where the set stands; on the site, a producer deciding whether the scanner really reads their sets. In two seconds the card says how large a save was and where in the set it landed; in ten, exactly what moved. Proof is the set's own data: the DAW's own track colours, device chains, tempo, clips and samples, never a mock.

Constraints: one server-rendered card for every surface; the client adds a client controller around it (hover linking between rows and skyline bars, a Changes / Whole set switch, a change stepper with `[` and `]`) that reads the DOM and receives no data. The site ships it as HTML under its 6 KiB script budget. Facets (tempo, time signature, key, clips, scenes, DAW version, samples, structure) are one module each, gated by the session's DAW capabilities. Track colours are the DAW's exact colours, shown only as small marks (a 6px swatch, skyline bars, group span hairlines) and never behind text; a recolour is not a change.

## Direction contract

THESIS: A save is drawn as the shape of the set it changed. The card refuses the text-only changelog (chips, a scalar grid and a flat list) and the dashboard answer (stat tiles, charts in boxes): it leads with one drawing of the whole set in the producer's own colours, marks what moved on that drawing, and gives the scalars that moved real gear.

OWN-WORLD: The Listening Room unchanged: glass with a left hairline (the rail's recipe), true-neutral ink, Departure Mono labels, Spline Sans Mono data, additions in `--art`, removals in faint ink with a line-through, no green, no boxes around rows. The one new material is the DAW's own palette, confined to 6px swatches, skyline bars at most 8px wide and 1px group spans.

STORY: The producer recognises their set at a glance by its colours and silhouette, sees where the marks fall, reads the tempo caret slide from the old value to the new, then finds each changed track in the outline, by pointer (hovering a row lights its bar) or by stepping through the changes.

FIRST VIEWPORT: Header: the file name with the DAW and its version at the right, the pair of saves under it in the label shape, the app's controls in an actions slot. Then the skyline: one bar per track in DAW order, height by chain length, groups as coloured spans beneath, returns and master after a gap, change marks under the baseline. Then readouts for what moved (tempo on the 60 to 200 BPM ruler, clip meters with the growth lit, other scalars as from and to). Then the outline with swatches, then samples.

FORM: Set skyline, chosen by the user from four presented structures (set skyline, instrument panel, diff hunk, device rack); a component-scope direction, so no concept-seed roll. Code-led (no image generation). Signature interaction: bars rise from the baseline left to right and the tempo caret slides from the old tempo to the new on arrival (scroll-driven on the site), and in the client a hovered row lights its bar while every other bar dims.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Open decisions

None. Settled with the user: session page defaults to the whole set and the history page to changes only; a key change reads as from and to text; bar height is chain length; Live 9 sets stay uncoloured (their palette differs).
