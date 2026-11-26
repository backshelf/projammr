//! The menu bar item's title and the words an accessibility reader gets for it. The bar is a readout, never a
//! meter: the set's name, how many saves wait for a commit, the branch when it is not `main`, and one glyph each
//! for a render waiting and for a push in flight.

/// The glyph after the count while a push is in flight.
pub const PUSHING: &str = "\u{2191}";
/// The glyph that closes the title while a render waits.
pub const RENDER: &str = "\u{266a}";

const SEPARATOR: &str = " \u{b7} ";
const COUNT: &str = " \u{25cf} ";

/// What the bar reads.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BarState<'a> {
    /// A hub sign-in is held. Without one the bar shows the icon alone.
    pub signed_in: bool,
    /// The DAW is running. With it stopped the bar shows the icon alone.
    pub live: bool,
    /// The open set's name, `None` with nothing open.
    pub set: Option<&'a str>,
    /// Saves since the set's last commit.
    pub saves: usize,
    pub branch: Option<&'a str>,
    /// Renders waiting in the panel.
    pub renders: usize,
    pub pushing: bool,
}

impl<'a> BarState<'a> {
    /// The set the bar names, when the bar names one at all.
    fn named(&self) -> Option<&'a str> {
        self.set
            .filter(|name| self.signed_in && self.live && !name.is_empty())
    }

    /// The branch the title shows: any but `main`.
    fn shown_branch(&self) -> Option<&'a str> {
        self.branch
            .filter(|branch| !branch.is_empty() && *branch != "main")
    }
}

/// The most characters the title takes: a long set name gives way, so the counts and glyphs after it stay whole.
pub const MAX_TITLE_CHARS: usize = 32;

/// How much of the name stays when a long branch name has to be cut as well.
const MIN_NAME_CHARS: usize = 8;

/// `text` cut to `max` characters, its last one an ellipsis when something was cut.
fn clip(text: &str, max: usize) -> String {
    let max = max.max(1);
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut clipped: String = text.chars().take(max - 1).collect();
    clipped.push('\u{2026}');
    clipped
}

/// The renders that wait for the producer, as the bar counts them: proposed (asking), or over the size limit (they
/// cannot be taken without a decision). One being uploaded, queued, added or rejected waits for no one.
pub fn waiting_renders(cards: &[crate::renders::RenderEvent]) -> usize {
    use crate::renders::RenderState;
    cards
        .iter()
        .filter(|card| matches!(card.state, RenderState::Proposed | RenderState::OverLimit))
        .count()
}

/// The status item's title: empty (the icon alone) unless a set is open on a signed-in machine with the DAW
/// running. `science123`, `science123 ● 3`, `science123 ● 3 · orchestral`, `science123 ● 3 · ♪`. The title is at most
/// [`MAX_TITLE_CHARS`] long: the set's name is cut with an ellipsis to make room, and a branch name that would leave
/// the set less than eight characters is cut first; the count and the glyphs are never cut.
pub fn bar_title(state: &BarState) -> String {
    let Some(name) = state.named() else {
        return String::new();
    };
    let mut counts = String::new();
    if state.saves > 0 {
        counts.push_str(COUNT);
        counts.push_str(&state.saves.to_string());
    }
    if state.pushing {
        counts.push(' ');
        counts.push_str(PUSHING);
    }
    let render = if state.renders > 0 {
        format!("{SEPARATOR}{RENDER}")
    } else {
        String::new()
    };
    let fixed = counts.chars().count() + render.chars().count();
    let name_chars = name.chars().count();
    let branch = state.shown_branch().map(|branch| {
        let separator = SEPARATOR.chars().count();
        let room = MAX_TITLE_CHARS
            .saturating_sub(fixed + separator + name_chars.min(MIN_NAME_CHARS))
            .max(1);
        format!("{SEPARATOR}{}", clip(branch, room))
    });
    let branch = branch.unwrap_or_default();
    let room = MAX_TITLE_CHARS.saturating_sub(fixed + branch.chars().count());
    format!("{}{counts}{branch}{render}", clip(name, room))
}

/// The title in words, for the item's accessibility label: what the glyphs stand for.
pub fn bar_label(state: &BarState) -> String {
    let Some(name) = state.named() else {
        return "dit".to_string();
    };
    let mut label = format!("dit, {name}");
    match state.saves {
        0 => {}
        1 => label.push_str(", 1 save since the last commit"),
        saves => label.push_str(&format!(", {saves} saves since the last commit")),
    }
    if let Some(branch) = state.shown_branch() {
        label.push_str(&format!(", on branch {branch}"));
    }
    match state.renders {
        0 => {}
        1 => label.push_str(", 1 render waiting"),
        renders => label.push_str(&format!(", {renders} renders waiting")),
    }
    if state.pushing {
        label.push_str(", pushing");
    }
    label
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open() -> BarState<'static> {
        BarState {
            signed_in: true,
            live: true,
            set: Some("science123"),
            ..BarState::default()
        }
    }

    #[test]
    fn the_title_grows_with_what_there_is_to_say() {
        let cases: [(BarState, &str); 9] = [
            (open(), "science123"),
            (BarState { saves: 3, ..open() }, "science123 \u{25cf} 3"),
            (
                BarState {
                    saves: 3,
                    branch: Some("orchestral"),
                    ..open()
                },
                "science123 \u{25cf} 3 \u{b7} orchestral",
            ),
            (
                BarState {
                    saves: 3,
                    renders: 1,
                    ..open()
                },
                "science123 \u{25cf} 3 \u{b7} \u{266a}",
            ),
            (
                BarState {
                    saves: 3,
                    branch: Some("orchestral"),
                    renders: 2,
                    ..open()
                },
                "science123 \u{25cf} 3 \u{b7} orchestral \u{b7} \u{266a}",
            ),
            (
                BarState {
                    saves: 3,
                    pushing: true,
                    ..open()
                },
                "science123 \u{25cf} 3 \u{2191}",
            ),
            (
                BarState {
                    pushing: true,
                    renders: 1,
                    ..open()
                },
                "science123 \u{2191} \u{b7} \u{266a}",
            ),
            (
                BarState {
                    branch: Some("main"),
                    saves: 1,
                    ..open()
                },
                "science123 \u{25cf} 1",
            ),
            (
                BarState {
                    renders: 1,
                    ..open()
                },
                "science123 \u{b7} \u{266a}",
            ),
        ];
        for (state, title) in cases {
            assert_eq!(bar_title(&state), title, "{state:?}");
        }
    }

    #[test]
    fn the_icon_stands_alone_when_nothing_can_be_named() {
        let alone = [
            BarState {
                set: None,
                ..open()
            },
            BarState {
                signed_in: false,
                saves: 4,
                ..open()
            },
            BarState {
                live: false,
                saves: 4,
                renders: 1,
                ..open()
            },
            BarState {
                set: Some(""),
                ..open()
            },
        ];
        for state in alone {
            assert_eq!(bar_title(&state), "", "{state:?}");
        }
    }

    #[test]
    fn the_label_says_in_words_what_the_glyphs_stand_for() {
        assert_eq!(bar_label(&BarState::default()), "dit");
        assert_eq!(bar_label(&open()), "dit, science123");
        let state = BarState {
            saves: 3,
            branch: Some("orchestral"),
            renders: 1,
            pushing: true,
            ..open()
        };
        assert_eq!(
            bar_label(&state),
            "dit, science123, 3 saves since the last commit, on branch orchestral, 1 render waiting, pushing"
        );
        assert_eq!(
            bar_label(&BarState {
                saves: 1,
                renders: 2,
                ..open()
            }),
            "dit, science123, 1 save since the last commit, 2 renders waiting"
        );
    }

    fn chars(title: &str) -> usize {
        title.chars().count()
    }

    #[test]
    fn a_long_set_name_is_cut_with_an_ellipsis_and_the_rest_of_the_title_stays_whole() {
        let name = "A very long working title for the orchestral suite";
        let state = BarState {
            set: Some(name),
            saves: 12,
            branch: Some("orchestral"),
            renders: 1,
            pushing: true,
            ..open()
        };

        let title = bar_title(&state);

        assert_eq!(
            title,
            "A very \u{2026} \u{25cf} 12 \u{2191} \u{b7} orchestral \u{b7} \u{266a}"
        );
        assert_eq!(chars(&title), MAX_TITLE_CHARS);
        let bare = bar_title(&BarState {
            set: Some(name),
            ..open()
        });
        assert_eq!(bare, "A very long working title for t\u{2026}");
        assert_eq!(chars(&bare), MAX_TITLE_CHARS);
    }

    #[test]
    fn a_name_that_fits_is_left_alone_even_at_the_limit() {
        let name = "x".repeat(MAX_TITLE_CHARS);
        assert_eq!(
            bar_title(&BarState {
                set: Some(&name),
                ..open()
            }),
            name
        );
        let over = "x".repeat(MAX_TITLE_CHARS + 1);
        let title = bar_title(&BarState {
            set: Some(&over),
            ..open()
        });
        assert_eq!(chars(&title), MAX_TITLE_CHARS);
        assert!(title.ends_with('\u{2026}'));
    }

    #[test]
    fn a_long_branch_is_cut_before_the_set_name_goes_below_eight_characters() {
        let state = BarState {
            set: Some("science123 remix session"),
            saves: 3,
            branch: Some("an-extremely-long-experimental-branch-name"),
            renders: 1,
            ..open()
        };

        let title = bar_title(&state);

        assert!(chars(&title) <= MAX_TITLE_CHARS, "{title}");
        assert!(title.starts_with("science\u{2026}"), "{title}");
        assert!(title.contains("\u{25cf} 3"), "{title}");
        assert!(title.ends_with(" \u{b7} \u{266a}"), "{title}");
        assert!(title.contains('\u{2026}'));
    }

    #[test]
    fn names_are_cut_by_characters_not_bytes() {
        let title = bar_title(&BarState {
            set: Some(
                "\u{30b7}\u{30f3}\u{30d5}\u{30a9}\u{30cb}\u{30fc}"
                    .repeat(8)
                    .as_str(),
            ),
            saves: 2,
            ..open()
        });
        assert!(chars(&title) <= MAX_TITLE_CHARS);
        assert!(title.contains("\u{2026} \u{25cf} 2"));
    }

    #[test]
    fn only_renders_that_wait_for_the_producer_are_counted_for_the_glyph() {
        use crate::renders::RenderEvent;
        use crate::renders::ledger::{Ledger, ProposalState};
        let mut ledger = Ledger::default();
        let mut cards = Vec::new();
        for state in [
            ProposalState::Waiting,
            ProposalState::Proposed,
            ProposalState::OverLimit,
            ProposalState::Uploading,
            ProposalState::QueuedOffline,
            ProposalState::Added,
            ProposalState::Rejected,
        ] {
            let id = ledger.propose("Mix", Vec::new(), 0);
            ledger.by_id_mut(id).unwrap().state = state;
            cards.push(RenderEvent::of(ledger.by_id(id).unwrap()));
        }
        assert_eq!(waiting_renders(&cards), 2);
        let state = BarState {
            renders: waiting_renders(&cards),
            ..open()
        };
        assert!(bar_title(&state).ends_with(RENDER));
        assert!(
            !bar_title(&BarState {
                renders: waiting_renders(&cards[..1]),
                ..open()
            })
            .ends_with(RENDER)
        );
    }
}
