//! The open-set chain: which set the DAW has open, from every signal that has an opinion.
//!
//! Signals rank script, log, window title, newest save. The best signal that has named a set wins. Two rules keep
//! the answer from flapping or lying:
//!
//! - A signal that stops naming a set (the script's `closed`, a Save As reloading the document) is believed for
//!   [`HOLD_MS`] before a lower signal may take over: the set last answered stays the answer meanwhile.
//! - With the DAW not running, only the saves can say anything: every other signal is a leftover of a run that is
//!   over.
//!
//! Pure like the tracker: every report carries its time and nothing here reads a clock.

use std::path::PathBuf;

use dit_core::{OpenSet, Signal};

/// How long a lower signal waits after a better one stops naming a set.
pub const HOLD_MS: i64 = 5_000;

/// What one signal last said.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Report {
    path: Option<PathBuf>,
    at: i64,
}

#[derive(Debug, Default)]
pub struct Chain {
    reports: [Option<Report>; 4],
    running: bool,
    /// The set last answered, for the hold.
    last: Option<OpenSet>,
}

fn slot(signal: Signal) -> usize {
    signal as usize
}

impl Chain {
    /// A chain that does not yet know the DAW is running.
    pub fn new() -> Self {
        Self::default()
    }

    /// `signal` names `path` as the open set at `at`; `None` says it names none (the set closed, or never saved).
    pub fn report(&mut self, signal: Signal, at: i64, path: Option<PathBuf>) {
        self.reports[slot(signal)] = Some(Report { path, at });
    }

    /// Whether the DAW is running, from the window list or the log.
    pub fn set_running(&mut self, running: bool) {
        self.running = running;
    }

    /// The set open at `now`, and which signal said so.
    pub fn current(&mut self, now: i64) -> Option<OpenSet> {
        self.current_held(now).0
    }

    /// [`Chain::current`] with whether the answer is only held: a better signal has stopped naming the set and the
    /// last answer stands for a few seconds in case another follows. Open time must not run on a held answer.
    pub fn current_held(&mut self, now: i64) -> (Option<OpenSet>, bool) {
        let (answer, held) = self.decide(now);
        self.last = answer.clone();
        (answer, held)
    }

    fn decide(&self, now: i64) -> (Option<OpenSet>, bool) {
        for signal in Signal::ALL {
            if signal != Signal::Saves && !self.running {
                continue;
            }
            let Some(report) = &self.reports[slot(signal)] else {
                continue;
            };
            match &report.path {
                Some(path) => {
                    let set = OpenSet {
                        path: path.clone(),
                        signal,
                        at: report.at,
                    };
                    return (Some(set), false);
                }
                // A better signal that has just stopped naming a set still holds the floor.
                None if self.last.is_some() && now - report.at < HOLD_MS => {
                    return (self.last.clone(), true);
                }
                None => {}
            }
        }
        (None, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(name: &str) -> Option<PathBuf> {
        Some(PathBuf::from(format!("/p/{name} Project/{name}.als")))
    }

    fn running() -> Chain {
        let mut chain = Chain::new();
        chain.set_running(true);
        chain
    }

    fn names(set: Option<OpenSet>) -> Option<(String, Signal)> {
        set.map(|set| {
            (
                set.path.file_stem().unwrap().to_string_lossy().into_owned(),
                set.signal,
            )
        })
    }

    #[test]
    fn the_best_signal_with_a_set_wins() {
        let mut chain = running();
        chain.report(Signal::Saves, 1, path("Saved"));
        assert_eq!(
            names(chain.current(2)),
            Some(("Saved".into(), Signal::Saves))
        );
        chain.report(Signal::Title, 3, path("Title"));
        assert_eq!(
            names(chain.current(4)),
            Some(("Title".into(), Signal::Title))
        );
        chain.report(Signal::Log, 5, path("Log"));
        chain.report(Signal::Script, 6, path("Script"));
        assert_eq!(
            names(chain.current(7)),
            Some(("Script".into(), Signal::Script))
        );
    }

    #[test]
    fn a_lower_signal_reporting_later_never_overrides_a_higher_one() {
        let mut chain = running();
        chain.report(Signal::Script, 1, path("A"));
        chain.report(Signal::Log, 9_000, path("B"));
        assert_eq!(
            names(chain.current(10_000)),
            Some(("A".into(), Signal::Script))
        );
    }

    #[test]
    fn when_the_script_stops_naming_a_set_the_last_answer_holds_for_a_few_seconds() {
        let mut chain = running();
        chain.report(Signal::Script, 0, path("A"));
        chain.report(Signal::Log, 0, path("B"));
        assert_eq!(names(chain.current(1)), Some(("A".into(), Signal::Script)));

        // Save As: the document is null for a moment.
        chain.report(Signal::Script, 10_000, None);
        assert_eq!(
            names(chain.current(10_001)),
            Some(("A".into(), Signal::Script))
        );
        assert_eq!(
            names(chain.current(14_999)),
            Some(("A".into(), Signal::Script))
        );
        assert_eq!(
            names(chain.current(15_000)),
            Some(("B".into(), Signal::Log))
        );

        // The new document arrives and wins at once.
        chain.report(Signal::Script, 15_500, path("C"));
        assert_eq!(
            names(chain.current(15_501)),
            Some(("C".into(), Signal::Script))
        );
    }

    #[test]
    fn a_held_answer_says_so() {
        let mut chain = running();
        chain.report(Signal::Script, 0, path("A"));
        assert!(!chain.current_held(1).1);
        chain.report(Signal::Script, 10_000, None);
        assert!(chain.current_held(10_001).1);
        assert_eq!(chain.current_held(15_000), (None, false));
    }

    #[test]
    fn with_the_daw_not_running_only_saves_speak() {
        let mut chain = Chain::new();
        chain.report(Signal::Script, 1, path("A"));
        chain.report(Signal::Log, 1, path("B"));
        chain.report(Signal::Title, 1, path("C"));
        assert_eq!(chain.current(2), None, "leftovers of a run that is over");

        chain.report(Signal::Saves, 3, path("D"));
        assert_eq!(names(chain.current(4)), Some(("D".into(), Signal::Saves)));

        chain.set_running(true);
        assert_eq!(names(chain.current(5)), Some(("A".into(), Signal::Script)));
    }

    #[test]
    fn nothing_reported_is_no_open_set() {
        assert_eq!(running().current(1), None);
    }

    #[test]
    fn a_signal_that_names_none_with_nothing_held_lets_the_next_one_answer_at_once() {
        let mut chain = running();
        chain.report(Signal::Script, 0, None);
        chain.report(Signal::Log, 0, path("B"));
        assert_eq!(names(chain.current(1)), Some(("B".into(), Signal::Log)));
    }
}
