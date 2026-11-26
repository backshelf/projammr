//! The segment tracker: what the app hears about a set (it opened, something happened, it closed, time passed)
//! becomes the spans `Repo::upsert_segment` keeps.
//!
//! The tracker is a pure state machine. Every [`Event`] carries its own time, so a test runs a day of work in a few
//! lines and the app feeds it the real clock; nothing here reads one. It answers each event with the [`Upsert`]s to
//! write: the span as it stands now, whose `start` names it, so writing it again replaces the earlier line.
//!
//! The rules, from the spec:
//!
//! - A span opens on the first signal for a set: an [`Event::Open`] from a source, or else an activity (a save, a
//!   script message), which is a `Saves` span.
//! - It stays open while things happen. With nothing for [`IDLE_AFTER_MS`] it ends at the last thing that happened,
//!   not fifteen minutes after; the next activity opens a new span with the same source. A span the transport is
//!   running in never goes idle, since the script says nothing between play and stop.
//! - A better source takes a span over: the script over the log over the title over saves. The span keeps its start.
//! - A close ends the span at the close, unless it had already gone idle.
//! - Spans of one set never overlap: a new one starts no earlier than the last ended, and an activity stamped inside
//!   a span already kept (a save found at launch, made while the app was away) adds nothing.
//! - Progress is written on a [`Event::Tick`], which the app sends at least once a minute, so a crash loses at most
//!   that minute and never the span: a span is written the moment it opens, with no length.

use std::collections::HashMap;

use dit_core::{Segment, Source};

/// Quiet this long and a span ends at the last thing that happened.
pub const IDLE_AFTER_MS: i64 = 15 * 60 * 1000;

/// The set and branch a span belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Key {
    pub set_id: String,
    pub branch: String,
}

/// What the app heard, with when, in milliseconds since the epoch. Events arrive in time order; one stamped before
/// what the tracker already knows (a save with an old mtime) never moves a span backwards.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// A signal of `source` says the set is open.
    Open { at: i64, key: Key, source: Source },
    /// Something happened in the set: a save, a script message.
    Activity { at: i64, key: Key },
    /// The transport started or stopped. While it plays the set is in use.
    Playing { at: i64, key: Key, playing: bool },
    /// The set was closed in the DAW.
    Close { at: i64, key: Key },
    /// Time passed with nothing heard: ends the spans that have gone idle and writes the progress of the rest.
    Tick { now: i64 },
}

impl Event {
    fn at(&self) -> i64 {
        match self {
            Event::Open { at, .. }
            | Event::Activity { at, .. }
            | Event::Playing { at, .. }
            | Event::Close { at, .. } => *at,
            Event::Tick { now } => *now,
        }
    }
}

/// A span to write: `Repo::upsert_segment(key.set_id, key.branch, segment)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Upsert {
    pub key: Key,
    pub segment: Segment,
}

/// A span in progress.
struct Open {
    start: i64,
    /// The last thing that happened in it: where it ends if it ends now.
    last: i64,
    source: Source,
    playing: bool,
    /// What was last handed out for it, so an unchanged span is not written again.
    written: Option<(i64, Source)>,
}

impl Open {
    fn upsert(&mut self, key: &Key) -> Option<Upsert> {
        let now = (self.last, self.source);
        if self.written == Some(now) {
            return None;
        }
        self.written = Some(now);
        Some(Upsert {
            key: key.clone(),
            segment: Segment {
                start: self.start,
                end: self.last,
                source: self.source,
            },
        })
    }
}

/// The last span of a set that ended: where the next must start after, and the source it resumes with.
struct Ended {
    end: i64,
    source: Source,
}

/// Counts the time sets are open. See the module's rules.
#[derive(Default)]
pub struct Tracker {
    open: HashMap<Key, Open>,
    ended: HashMap<Key, Ended>,
}

impl Tracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// Tells a tracker started after the app was away the last span the store holds for a set. A span cut off by a
    /// crash stays as it was last written; the new ones start after it, and an activity stamped inside it is not
    /// counted again.
    pub fn resume(&mut self, key: Key, last: &Segment) {
        self.ended.insert(
            key,
            Ended {
                end: last.end,
                source: last.source,
            },
        );
    }

    /// Takes one event and returns the spans to write, in the order of their keys then starts.
    pub fn handle(&mut self, event: Event) -> Vec<Upsert> {
        let now = event.at();
        let mut written = self.expire(now);
        match event {
            Event::Open { at, key, source } => written.extend(self.open_signal(at, key, source)),
            Event::Activity { at, key } => written.extend(self.activity(at, key)),
            Event::Playing { at, key, playing } => {
                // A stop is activity in a span that is open; it opens none.
                if playing || self.open.contains_key(&key) {
                    written.extend(self.activity(at, key.clone()));
                }
                if let Some(open) = self.open.get_mut(&key) {
                    open.playing = playing;
                }
            }
            Event::Close { at, key } => written.extend(self.close(at, key)),
            Event::Tick { now } => {
                for open in self.open.values_mut().filter(|open| open.playing) {
                    open.last = open.last.max(now);
                }
                written.extend(
                    self.open
                        .iter_mut()
                        .filter_map(|(key, open)| open.upsert(key)),
                );
            }
        }
        written.sort_by(|a, b| (&a.key, a.segment.start).cmp(&(&b.key, b.segment.start)));
        written
    }

    /// Ends the spans quiet since `now - IDLE_AFTER_MS` at their last activity. A playing span is never quiet.
    fn expire(&mut self, now: i64) -> Vec<Upsert> {
        let idle: Vec<Key> = self
            .open
            .iter()
            .filter(|(_, open)| !open.playing && now - open.last >= IDLE_AFTER_MS)
            .map(|(key, _)| key.clone())
            .collect();
        idle.into_iter()
            .filter_map(|key| self.end(key, None))
            .collect()
    }

    /// Ends the span of `key`, at `at` if given and later than its last activity, and remembers where it ended.
    fn end(&mut self, key: Key, at: Option<i64>) -> Option<Upsert> {
        let mut open = self.open.remove(&key)?;
        open.last = open.last.max(at.unwrap_or(open.last));
        let upsert = open.upsert(&key);
        self.ended.insert(
            key,
            Ended {
                end: open.last,
                source: open.source,
            },
        );
        upsert
    }

    fn close(&mut self, at: i64, key: Key) -> Option<Upsert> {
        self.end(key, Some(at))
    }

    /// Starts a span for `key` no earlier than the last one ended.
    fn begin(&mut self, at: i64, key: Key, source: Source) -> Option<Upsert> {
        let start = self.ended.get(&key).map_or(at, |ended| ended.end.max(at));
        let mut open = Open {
            start,
            last: start,
            source,
            playing: false,
            written: None,
        };
        let upsert = open.upsert(&key);
        self.open.insert(key, open);
        upsert
    }

    fn open_signal(&mut self, at: i64, key: Key, source: Source) -> Option<Upsert> {
        let Some(open) = self.open.get_mut(&key) else {
            return self.begin(at, key, source);
        };
        open.last = open.last.max(at);
        if !source.outranks(open.source) {
            return None;
        }
        open.source = source;
        open.upsert(&key)
    }

    fn activity(&mut self, at: i64, key: Key) -> Option<Upsert> {
        if let Some(open) = self.open.get_mut(&key) {
            // Stamped before the span began: it happened before this span, not in it.
            if at >= open.start {
                open.last = open.last.max(at);
            }
            return None;
        }
        match self.ended.get(&key) {
            // Inside a span already kept.
            Some(ended) if at <= ended.end => None,
            Some(ended) => {
                let source = ended.source;
                self.begin(at, key, source)
            }
            None => self.begin(at, key, Source::Saves),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;

    fn key(set: &str) -> Key {
        Key {
            set_id: set.into(),
            branch: "main".into(),
        }
    }

    fn open(at: i64, set: &str, source: Source) -> Event {
        Event::Open {
            at: at * MIN,
            key: key(set),
            source,
        }
    }

    fn activity(at: i64, set: &str) -> Event {
        Event::Activity {
            at: at * MIN,
            key: key(set),
        }
    }

    fn tick(now: i64) -> Event {
        Event::Tick { now: now * MIN }
    }

    fn span(start: i64, end: i64, source: Source) -> Segment {
        Segment {
            start: start * MIN,
            end: end * MIN,
            source,
        }
    }

    fn segments(upserts: Vec<Upsert>) -> Vec<Segment> {
        upserts.into_iter().map(|upsert| upsert.segment).collect()
    }

    /// What the store holds after `upserts`: one line for each start, the last write winning.
    fn store(upserts: &[Upsert], set: &str) -> Vec<Segment> {
        let mut held: Vec<Segment> = Vec::new();
        for upsert in upserts.iter().filter(|upsert| upsert.key == key(set)) {
            match held
                .iter_mut()
                .find(|held| held.start == upsert.segment.start)
            {
                Some(held) => *held = upsert.segment,
                None => held.push(upsert.segment),
            }
        }
        held.sort_by_key(|segment| segment.start);
        held
    }

    /// Runs `events` through a fresh tracker and returns everything it wrote.
    fn run(events: Vec<Event>) -> Vec<Upsert> {
        let mut tracker = Tracker::new();
        events
            .into_iter()
            .flat_map(|event| tracker.handle(event))
            .collect()
    }

    #[test]
    fn a_span_is_written_the_moment_it_opens_with_no_length() {
        let mut tracker = Tracker::new();

        let written = tracker.handle(open(10, "a", Source::Script));

        assert_eq!(segments(written), [span(10, 10, Source::Script)]);
    }

    #[test]
    fn a_tick_writes_the_progress_and_only_when_it_moved() {
        let mut tracker = Tracker::new();
        tracker.handle(open(0, "a", Source::Script));

        assert!(
            tracker.handle(activity(3, "a")).is_empty(),
            "activity alone writes nothing"
        );
        assert_eq!(
            segments(tracker.handle(tick(4))),
            [span(0, 3, Source::Script)]
        );
        assert!(
            tracker.handle(tick(5)).is_empty(),
            "nothing new since the last write"
        );
        tracker.handle(activity(6, "a"));
        assert_eq!(
            segments(tracker.handle(tick(7))),
            [span(0, 6, Source::Script)]
        );
    }

    #[test]
    fn fifteen_quiet_minutes_close_a_span_at_the_last_activity() {
        let written = run(vec![
            open(0, "a", Source::Script),
            activity(10, "a"),
            tick(24),
            tick(25),
            tick(26),
        ]);

        assert_eq!(store(&written, "a"), [span(0, 10, Source::Script)]);
        let at_25: Vec<_> = written
            .iter()
            .filter(|u| u.segment.end == 10 * MIN)
            .collect();
        assert_eq!(
            at_25.len(),
            1,
            "written once, when it closed, not again at the next tick"
        );
    }

    #[test]
    fn fourteen_minutes_are_not_idle() {
        let mut tracker = Tracker::new();
        tracker.handle(open(0, "a", Source::Script));
        tracker.handle(activity(10, "a"));

        let at_24 = tracker.handle(tick(24));

        assert_eq!(segments(at_24), [span(0, 10, Source::Script)]);
        assert_eq!(tracker.open.len(), 1, "still open");
    }

    #[test]
    fn the_next_activity_after_idle_opens_a_new_span_with_the_same_source() {
        let written = run(vec![
            open(0, "a", Source::Script),
            activity(5, "a"),
            tick(21),
            activity(40, "a"),
            tick(41),
        ]);

        assert_eq!(
            store(&written, "a"),
            [span(0, 5, Source::Script), span(40, 40, Source::Script)]
        );
    }

    #[test]
    fn a_save_with_nothing_else_open_is_a_span_of_saves_from_the_first_to_the_last() {
        let written = run(vec![
            activity(0, "a"),
            activity(6, "a"),
            activity(12, "a"),
            tick(13),
            tick(28),
            activity(60, "a"),
            tick(61),
        ]);

        assert_eq!(
            store(&written, "a"),
            [span(0, 12, Source::Saves), span(60, 60, Source::Saves)]
        );
    }

    #[test]
    fn a_better_source_takes_a_span_over_and_a_worse_one_does_not() {
        let written = run(vec![
            activity(0, "a"),
            open(1, "a", Source::Title),
            open(2, "a", Source::Log),
            open(3, "a", Source::Script),
            open(4, "a", Source::Title),
            open(5, "a", Source::Log),
            tick(6),
        ]);

        assert_eq!(store(&written, "a"), [span(0, 5, Source::Script)]);
        let sources: Vec<_> = written.iter().map(|u| u.segment.source).collect();
        assert_eq!(
            sources,
            [
                Source::Saves,
                Source::Title,
                Source::Log,
                Source::Script,
                Source::Script
            ],
            "each upgrade is written, the ones that changed nothing are not, and the tick writes the progress"
        );
    }

    #[test]
    fn the_transport_playing_keeps_a_span_alive_and_ends_it_at_the_stop() {
        let mut tracker = Tracker::new();
        let mut written = tracker.handle(open(0, "a", Source::Script));
        written.extend(tracker.handle(Event::Playing {
            at: MIN,
            key: key("a"),
            playing: true,
        }));
        // Two hours of a take with no message from the script, a tick every minute.
        for minute in 2..=120 {
            written.extend(tracker.handle(tick(minute)));
        }
        written.extend(tracker.handle(Event::Playing {
            at: 120 * MIN,
            key: key("a"),
            playing: false,
        }));
        written.extend(tracker.handle(tick(135)));
        written.extend(tracker.handle(tick(136)));

        assert_eq!(store(&written, "a"), [span(0, 120, Source::Script)]);
        assert!(
            tracker.open.is_empty(),
            "idle 15 minutes after the stop, not before"
        );
    }

    #[test]
    fn a_stop_with_no_span_open_opens_nothing() {
        let written = run(vec![Event::Playing {
            at: 5 * MIN,
            key: key("a"),
            playing: false,
        }]);

        assert!(written.is_empty());
    }

    #[test]
    fn a_stop_with_nothing_after_it_ends_the_span_at_the_stop_not_fifteen_minutes_on() {
        let written = run(vec![
            open(0, "a", Source::Script),
            Event::Playing {
                at: MIN,
                key: key("a"),
                playing: true,
            },
            tick(30),
            Event::Playing {
                at: 30 * MIN,
                key: key("a"),
                playing: false,
            },
            tick(46),
        ]);

        assert_eq!(store(&written, "a"), [span(0, 30, Source::Script)]);
    }

    #[test]
    fn a_close_ends_the_span_at_the_close() {
        let written = run(vec![
            open(0, "a", Source::Script),
            activity(10, "a"),
            activity(20, "a"),
            Event::Close {
                at: 30 * MIN,
                key: key("a"),
            },
        ]);

        assert_eq!(store(&written, "a"), [span(0, 30, Source::Script)]);
    }

    #[test]
    fn a_close_after_a_quiet_quarter_hour_ends_at_the_last_activity() {
        let written = run(vec![
            open(0, "a", Source::Script),
            activity(5, "a"),
            Event::Close {
                at: 40 * MIN,
                key: key("a"),
            },
        ]);

        assert_eq!(store(&written, "a"), [span(0, 5, Source::Script)]);
    }

    #[test]
    fn a_crash_leaves_the_span_as_last_written_and_the_next_run_starts_after_it() {
        // The first run wrote up to minute 10 and died.
        let before_crash = run(vec![
            open(0, "a", Source::Script),
            activity(10, "a"),
            tick(11),
        ]);
        assert_eq!(store(&before_crash, "a"), [span(0, 10, Source::Script)]);

        // The next run starts with the store's last span.
        let mut tracker = Tracker::new();
        tracker.resume(key("a"), &span(0, 10, Source::Script));
        let mut after = Vec::new();
        // A save found at launch, stamped inside the span that was kept, adds nothing.
        after.extend(tracker.handle(activity(5, "a")));
        // Work resumes at minute 30 as a span of its own, in the span's source.
        after.extend(tracker.handle(activity(30, "a")));
        after.extend(tracker.handle(tick(31)));

        assert!(
            after.iter().all(|u| u.segment.start >= 30 * MIN),
            "{after:?}"
        );
        let all: Vec<Upsert> = before_crash.into_iter().chain(after).collect();
        assert_eq!(
            store(&all, "a"),
            [span(0, 10, Source::Script), span(30, 30, Source::Script)]
        );
    }

    #[test]
    fn a_run_that_was_never_told_of_the_old_span_still_never_extends_it() {
        let mut tracker = Tracker::new();

        let written = segments(tracker.handle(activity(30, "a")));

        assert_eq!(written, [span(30, 30, Source::Saves)]);
    }

    #[test]
    fn a_span_never_starts_before_the_last_one_ended_so_spans_of_a_set_never_overlap() {
        let written = run(vec![
            open(0, "a", Source::Script),
            activity(10, "a"),
            Event::Close {
                at: 20 * MIN,
                key: key("a"),
            },
            // The clock stepped back, or a log line was stamped early.
            open(15, "a", Source::Log),
            tick(16),
        ]);

        assert_eq!(
            store(&written, "a"),
            [span(0, 20, Source::Script), span(20, 20, Source::Log)]
        );
    }

    #[test]
    fn an_activity_stamped_before_the_open_span_began_does_not_pull_it_back() {
        let written = run(vec![
            open(10, "a", Source::Script),
            activity(2, "a"),
            tick(11),
            Event::Close {
                at: 12 * MIN,
                key: key("a"),
            },
        ]);

        assert_eq!(store(&written, "a"), [span(10, 12, Source::Script)]);
    }

    #[test]
    fn two_sets_are_counted_on_their_own() {
        let written = run(vec![
            open(0, "a", Source::Script),
            activity(1, "b"),
            activity(10, "a"),
            activity(12, "b"),
            tick(30),
        ]);

        assert_eq!(store(&written, "a"), [span(0, 10, Source::Script)]);
        assert_eq!(store(&written, "b"), [span(1, 12, Source::Saves)]);
    }

    #[test]
    fn upserts_come_back_in_the_order_of_their_keys_and_starts() {
        let mut tracker = Tracker::new();
        tracker.handle(open(0, "a", Source::Script));
        tracker.handle(open(1, "b", Source::Script));
        tracker.handle(activity(2, "a"));
        tracker.handle(activity(3, "b"));

        let written = tracker.handle(tick(4));

        let keys: Vec<_> = written.iter().map(|u| u.key.set_id.as_str()).collect();
        assert_eq!(keys, ["a", "b"]);
    }
}
