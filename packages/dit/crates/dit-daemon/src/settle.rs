//! When is a file done being written? One [`Settle`] follows one path from the first filesystem event that made it
//! dirty to the moment it is worth recording, and says when to look next. Pure: the caller passes the time and, at
//! a check, what it found.
//!
//! - A set file ([`Rule::Decode`]) waits [`SET_QUIET_MS`] after its last event, then must decode: Live writes a
//!   gzip whose trailer (CRC and length) is the proof it is whole, so a file that decodes is done. A file that does
//!   not is torn: it is looked at again after 2, 4, 8, 16 and 30 seconds, then every 30 seconds, and dropped after
//!   [`GIVE_UP_MS`] of being torn (the next event starts over).
//! - A sample or a render ([`Rule::Stable`]) has no integrity check, so it is whole when its `(size, mtime)` is the
//!   same at two looks [`STABLE_MS`] apart.
//! - A stream of events cannot starve either: the first check comes no later than [`MAX_WAIT_MS`] after the first
//!   event of a burst.

/// Quiet time after the last event of a set file before it is read.
pub const SET_QUIET_MS: i64 = 2_000;
/// The longest a burst of events can keep the first check waiting.
pub const MAX_WAIT_MS: i64 = 10_000;
/// How long a sample's size and mtime must hold still.
pub const STABLE_MS: i64 = 5_000;
/// How long a torn file is retried before it is left until the next event.
pub const GIVE_UP_MS: i64 = 10 * 60_000;
/// The waits after a torn read; the last repeats.
const LADDER_MS: [i64; 5] = [2_000, 4_000, 8_000, 16_000, 30_000];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rule {
    /// A set file: quiet, then it decodes.
    Decode,
    /// A sample or render: size and mtime stable.
    Stable,
}

/// What a look at the file found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Probe {
    /// (`Decode`) it decodes.
    Whole,
    /// (`Decode`) it does not decode yet.
    Torn,
    /// The file is not there.
    Gone,
    /// (`Stable`) its size in bytes and mtime in milliseconds.
    Stat { size: u64, mtime: i64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    /// Done: record it.
    Ready,
    /// Not yet: [`Settle::next_check`] says when to look again.
    Wait,
    /// Torn for too long: stop until the next event.
    GaveUp,
    /// Not there: nothing to record (a later event re-arms it).
    Gone,
}

#[derive(Debug, Clone)]
pub struct Settle {
    rule: Rule,
    first_event: i64,
    last_event: i64,
    next_check: i64,
    torn: u32,
    first_torn: Option<i64>,
    snapshot: Option<(u64, i64)>,
}

impl Settle {
    /// A path that just became dirty at `now`.
    pub fn new(rule: Rule, now: i64) -> Self {
        let mut settle = Settle {
            rule,
            first_event: now,
            last_event: now,
            next_check: now,
            torn: 0,
            first_torn: None,
            snapshot: None,
        };
        settle.next_check = settle.after_event();
        settle
    }

    fn quiet(&self) -> i64 {
        match self.rule {
            Rule::Decode => SET_QUIET_MS,
            Rule::Stable => STABLE_MS,
        }
    }

    fn after_event(&self) -> i64 {
        (self.last_event + self.quiet()).min(self.first_event + MAX_WAIT_MS)
    }

    /// Another event for the path at `now`: it changed again, so the quiet period starts over (within the
    /// max-wait) and what was torn is no longer known to be.
    pub fn event(&mut self, now: i64) {
        self.last_event = now;
        self.torn = 0;
        self.first_torn = None;
        self.next_check = self.after_event();
    }

    /// What a `Stable` path looked like at its latest event, so the first check can already tell it held still.
    pub fn observe(&mut self, size: u64, mtime: i64) {
        self.snapshot = Some((size, mtime));
    }

    /// Looks again no earlier than `until` (the repo was busy, say).
    pub fn defer(&mut self, until: i64) {
        self.next_check = until;
    }

    pub fn next_check(&self) -> i64 {
        self.next_check
    }

    pub fn due(&self, now: i64) -> bool {
        now >= self.next_check
    }

    /// A check at `now`; `probe` looks at the file and is only called when the check is due.
    pub fn check(&mut self, now: i64, probe: impl FnOnce() -> Probe) -> Verdict {
        if !self.due(now) {
            return Verdict::Wait;
        }
        match (self.rule, probe()) {
            (_, Probe::Gone) => Verdict::Gone,
            (Rule::Decode, Probe::Whole) => Verdict::Ready,
            (Rule::Decode, _) => self.tear(now),
            (Rule::Stable, Probe::Stat { size, mtime }) => {
                if self.snapshot == Some((size, mtime)) {
                    return Verdict::Ready;
                }
                self.snapshot = Some((size, mtime));
                self.first_event = now;
                self.next_check = now + STABLE_MS;
                Verdict::Wait
            }
            // A probe that does not fit the rule is no evidence the file is whole.
            (Rule::Stable, _) => Verdict::Wait,
        }
    }

    /// The file turned out torn at `now` (a probe said so, or the read changed under the recording): look again on
    /// the ladder, or give up.
    pub fn tear(&mut self, now: i64) -> Verdict {
        let since = *self.first_torn.get_or_insert(now);
        if now - since >= GIVE_UP_MS {
            return Verdict::GaveUp;
        }
        let wait = LADDER_MS[(self.torn as usize).min(LADDER_MS.len() - 1)];
        self.torn += 1;
        self.first_event = now;
        self.next_check = now + wait;
        Verdict::Wait
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: i64 = 1000;

    #[test]
    fn a_set_file_is_checked_two_seconds_after_its_last_event() {
        let mut settle = Settle::new(Rule::Decode, 0);
        assert_eq!(settle.next_check(), 2 * S);
        settle.event(1500);
        assert_eq!(settle.next_check(), 3500);
        assert!(!settle.due(3499) && settle.due(3500));
    }

    #[test]
    fn a_stream_of_events_cannot_push_the_first_check_past_ten_seconds() {
        let mut settle = Settle::new(Rule::Decode, 0);
        for at in (1..=30).map(|n| n * S) {
            settle.event(at);
        }
        assert_eq!(settle.next_check(), 10 * S, "capped from the first event");
    }

    #[test]
    fn a_whole_file_is_ready_and_a_missing_one_is_gone() {
        let mut settle = Settle::new(Rule::Decode, 0);
        assert_eq!(settle.check(S, || panic!("not due")), Verdict::Wait);
        assert_eq!(settle.check(2 * S, || Probe::Whole), Verdict::Ready);
        let mut gone = Settle::new(Rule::Decode, 0);
        assert_eq!(gone.check(2 * S, || Probe::Gone), Verdict::Gone);
    }

    #[test]
    fn a_torn_file_is_retried_after_2_4_8_16_30_then_every_30_seconds() {
        let mut settle = Settle::new(Rule::Decode, 0);
        let mut now = 2 * S;
        let mut waits = Vec::new();
        for _ in 0..8 {
            assert_eq!(settle.check(now, || Probe::Torn), Verdict::Wait);
            waits.push(settle.next_check() - now);
            now = settle.next_check();
        }
        assert_eq!(waits, [2, 4, 8, 16, 30, 30, 30, 30].map(|s| s * S));
    }

    #[test]
    fn a_file_torn_for_ten_minutes_is_given_up_and_a_new_event_starts_over() {
        let mut settle = Settle::new(Rule::Decode, 0);
        let mut now = 2 * S;
        let verdict = loop {
            match settle.check(now, || Probe::Torn) {
                Verdict::Wait => now = settle.next_check(),
                done => break done,
            }
        };
        assert_eq!(verdict, Verdict::GaveUp);
        assert!(now - 2 * S >= GIVE_UP_MS);

        settle.event(now + 100);
        assert_eq!(
            settle.check(now + 100 + 2 * S, || Probe::Torn),
            Verdict::Wait
        );
    }

    #[test]
    fn a_torn_recording_steps_the_ladder_without_a_probe() {
        let mut settle = Settle::new(Rule::Decode, 0);
        assert_eq!(settle.check(2 * S, || Probe::Whole), Verdict::Ready);
        assert_eq!(settle.tear(2 * S), Verdict::Wait);
        assert_eq!(settle.next_check(), 4 * S);
        assert_eq!(settle.tear(4 * S), Verdict::Wait);
        assert_eq!(settle.next_check(), 8 * S);
    }

    #[test]
    fn a_sample_is_ready_when_size_and_mtime_held_over_five_seconds() {
        let mut settle = Settle::new(Rule::Stable, 0);
        settle.observe(100, 7);
        assert_eq!(settle.next_check(), 5 * S);
        assert_eq!(
            settle.check(5 * S, || Probe::Stat {
                size: 100,
                mtime: 7
            }),
            Verdict::Ready
        );
    }

    #[test]
    fn a_sample_that_grew_waits_another_five_seconds_from_that_look() {
        let mut settle = Settle::new(Rule::Stable, 0);
        settle.observe(100, 7);
        assert_eq!(
            settle.check(5 * S, || Probe::Stat {
                size: 160,
                mtime: 9
            }),
            Verdict::Wait
        );
        assert_eq!(settle.next_check(), 10 * S);
        assert_eq!(
            settle.check(10 * S, || Probe::Stat {
                size: 160,
                mtime: 9
            }),
            Verdict::Ready
        );
    }

    #[test]
    fn a_sample_with_no_look_at_its_event_is_ready_on_the_second_look() {
        let mut settle = Settle::new(Rule::Stable, 0);
        assert_eq!(
            settle.check(5 * S, || Probe::Stat { size: 1, mtime: 1 }),
            Verdict::Wait
        );
        assert_eq!(
            settle.check(10 * S, || Probe::Stat { size: 1, mtime: 1 }),
            Verdict::Ready
        );
    }

    #[test]
    fn deferring_moves_the_next_check() {
        let mut settle = Settle::new(Rule::Decode, 0);
        settle.defer(7 * S);
        assert!(!settle.due(6 * S) && settle.due(7 * S));
    }
}
