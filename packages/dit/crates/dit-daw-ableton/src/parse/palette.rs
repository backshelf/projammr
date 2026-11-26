//! Live's track colours. The palette values and Live 10's shifted numbering
//! are as tabulated by kevinkirsten in ableton-als
//! (`src/core/live-palette.ts`, <https://github.com/kevinkirsten/ableton-als>).

/// The 70 colours Live 10 and later offer for a track, as the colour picker
/// lays them out: five rows of fourteen, read left to right from the top.
const LIVE_PALETTE: [&str; 70] = [
    "#ff94a6", "#ffa529", "#cc9927", "#f7f47c", "#bffb00", "#1aff2f", "#25ffa8", "#5cffe8",
    "#8bc5ff", "#5480e4", "#92a7ff", "#d86ce4", "#e553a0", "#ffffff", "#ff3636", "#f66c03",
    "#99724b", "#fff034", "#87ff67", "#3dc300", "#00bfaf", "#19e9ff", "#10a4ee", "#007dc0",
    "#886ce4", "#b677c6", "#ff39d4", "#d0d0d0", "#e2675a", "#ffa374", "#d3ad71", "#edffae",
    "#d2e498", "#bad074", "#9bc48d", "#d4fde1", "#cdf1f8", "#b9c1e3", "#cdbbe4", "#ae98e5",
    "#e5dce1", "#a9a9a9", "#c6928b", "#b78256", "#99836a", "#bfba69", "#a6be00", "#7db04d",
    "#88c2ba", "#9bb3c4", "#85a5c2", "#8393cc", "#a595b5", "#bf9fbe", "#bc7196", "#7b7b7b",
    "#af3333", "#a95131", "#724f41", "#dbc300", "#85961f", "#539f31", "#0a9c8e", "#236384",
    "#1a2f96", "#2f52a2", "#624bad", "#a34bad", "#cc2e6e", "#3c3c3c",
];

/// The major version whose `ColorIndex` numbering is the shifted one below.
const LIVE_10: u32 = 10;

/// The colour a track element's value names as `#rrggbb`, or `None` where it
/// names none. Live 11 and later write `Color`, a plain palette index. Live 10
/// wrote `ColorIndex` in its shifted numbering; earlier versions wrote the same
/// element over a different palette, so their colours are not read at all.
pub(super) fn track_color(
    element: &str,
    value: i64,
    live_major: Option<u32>,
) -> Option<&'static str> {
    match element {
        "Color" => palette_color(value),
        "ColorIndex" if live_major == Some(LIVE_10) => {
            live_10_palette_index(value).and_then(palette_color)
        }
        _ => None,
    }
}

/// The colour at palette index `index` as `#rrggbb`: what a track's `Color` names in a saved set and what Live's
/// own API gives a track as its colour index, so a live track and a saved one read from one table.
pub(crate) fn palette_color(index: i64) -> Option<&'static str> {
    LIVE_PALETTE.get(usize::try_from(index).ok()?).copied()
}

/// A palette index as Live 10 writes it on a track: the first sixty colours
/// from 140, the ten Live 10 added from 278, and 0 for a track with none.
fn live_10_palette_index(value: i64) -> Option<i64> {
    match value {
        140..=199 => Some(value - 140),
        278..=287 => Some(value - 218),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_color_element_indexes_the_palette_directly() {
        assert_eq!(track_color("Color", 0, Some(12)), Some("#ff94a6"));
        assert_eq!(track_color("Color", 14, None), Some("#ff3636"));
        assert_eq!(track_color("Color", 69, Some(11)), Some("#3c3c3c"));
    }

    #[test]
    fn the_palette_colour_is_the_one_a_saved_track_gets() {
        assert_eq!(palette_color(16), track_color("Color", 16, Some(12)));
        assert_eq!(palette_color(16), Some("#99724b"));
        assert_eq!(palette_color(70), None);
        assert_eq!(palette_color(-1), None);
    }

    #[test]
    fn an_index_outside_the_palette_names_no_colour() {
        assert_eq!(track_color("Color", 70, Some(12)), None);
        assert_eq!(track_color("Color", -1, Some(12)), None);
    }

    #[test]
    fn live_10_shifts_its_color_index_numbering() {
        assert_eq!(track_color("ColorIndex", 140, Some(10)), Some("#ff94a6"));
        assert_eq!(track_color("ColorIndex", 154, Some(10)), Some("#ff3636"));
        assert_eq!(track_color("ColorIndex", 199, Some(10)), Some("#dbc300"));
        assert_eq!(track_color("ColorIndex", 278, Some(10)), Some("#85961f"));
        assert_eq!(track_color("ColorIndex", 287, Some(10)), Some("#3c3c3c"));
    }

    #[test]
    fn a_color_index_outside_live_10s_ranges_names_no_colour() {
        for value in [0, 139, 200, 277, 288] {
            assert_eq!(track_color("ColorIndex", value, Some(10)), None, "{value}");
        }
    }

    #[test]
    fn a_color_index_is_read_only_from_a_live_10_set() {
        for major in [None, Some(9), Some(11), Some(12)] {
            assert_eq!(track_color("ColorIndex", 154, major), None, "{major:?}");
        }
    }

    #[test]
    fn any_other_element_names_no_colour() {
        assert_eq!(track_color("Hue", 14, Some(12)), None);
    }
}
