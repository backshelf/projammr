//! The machine's beat: a report to the hub every 30 s that this computer is here, what session it has open and which
//! repos it keeps, so the hub can say where a session is open and who has a copy.
//!
//! A beat goes every 30 s while the hub answers, one more at once when something worth telling changes, and a wait
//! starts at 5 s and doubles to a 60 s cap while it does not. One beat is out at a time; a beat asked for while one
//! is out goes as soon as that one is back, since what it carried may be out of date; an answer that arrives after
//! the beat was stopped belongs to a session that has ended and is dropped (the generation counter says so).
//!
//! [`Beater`] is that rule as a state machine over a clock it is given, so a test steps it by hand; [`Beat`] runs it
//! on a thread and makes the requests.

use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use dit_core::remote::{Machine, Presence, Remote, RemoteError, beat};

use crate::Clock;
use crate::event::DaemonEvent;

/// How often a machine reports in while the hub answers.
pub const INTERVAL_MS: i64 = 30_000;

/// The wait after a first failed beat; each failure after it doubles the wait.
const RETRY_MS: i64 = 5_000;

/// The longest wait between beats while the hub does not answer.
const RETRY_CAP_MS: i64 = 60_000;

/// The wait before the next beat after `failures` beats in a row failed.
pub fn next_delay_ms(failures: u32) -> i64 {
    if failures == 0 {
        INTERVAL_MS
    } else {
        retry_delay_ms(failures)
    }
}

/// The wait before trying again after `failures` (at least one) attempts in a row failed: 5 s, doubling, to 60 s.
pub fn retry_delay_ms(failures: u32) -> i64 {
    let doublings = failures.saturating_sub(1).min(16);
    (RETRY_MS << doublings).min(RETRY_CAP_MS)
}

/// How a beat ended, as the state machine needs it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Answered,
    Failed,
}

/// A beat that was allowed to go out, which says which run of the beater it belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ticket {
    generation: u64,
}

/// What became of a finished beat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Finished {
    /// It counted: the next beat is scheduled, or goes at once.
    Counted,
    /// The beater was stopped while it was out: its answer is dropped.
    Stale,
}

/// When to beat: the beat's rule as a state machine.
#[derive(Debug, Default)]
pub struct Beater {
    running: bool,
    failures: u32,
    due_at: Option<i64>,
    in_flight: bool,
    beat_again: bool,
    /// Moves on every start and stop, so a beat can tell its run has ended.
    generation: u64,
}

impl Beater {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_running(&self) -> bool {
        self.running
    }

    /// The consecutive beats that failed.
    pub fn failures(&self) -> u32 {
        self.failures
    }

    /// Starts beating, at once. Starting a running beater does nothing.
    pub fn start(&mut self, now: i64) {
        if self.running {
            return;
        }
        self.running = true;
        self.failures = 0;
        self.generation += 1;
        self.beat_now(now);
    }

    pub fn stop(&mut self) {
        self.running = false;
        self.beat_again = false;
        self.generation += 1;
        self.due_at = None;
    }

    /// A beat now, outside the interval: the open set changed, or the machine woke. One already out goes again as
    /// soon as it is back.
    pub fn beat_now(&mut self, now: i64) {
        if !self.running {
            return;
        }
        if self.in_flight {
            self.beat_again = true;
            return;
        }
        self.due_at = Some(now);
    }

    /// The machine woke: whatever backoff it was in is over.
    pub fn wake(&mut self, now: i64) {
        self.failures = 0;
        self.beat_now(now);
    }

    /// Lets a beat go out when one is due and none is out.
    pub fn poll(&mut self, now: i64) -> Option<Ticket> {
        if !self.running || self.in_flight || self.due_at.is_none_or(|due| due > now) {
            return None;
        }
        self.due_at = None;
        self.in_flight = true;
        Some(Ticket {
            generation: self.generation,
        })
    }

    /// Takes the result of the beat `ticket` let out.
    pub fn finish(&mut self, ticket: Ticket, now: i64, outcome: Outcome) -> Finished {
        self.in_flight = false;
        if ticket.generation != self.generation {
            // Stopped while it was out, and perhaps started again: a beat the new run asked for is still owed.
            if self.beat_again {
                self.beat_again = false;
                self.beat_now(now);
            }
            return Finished::Stale;
        }
        self.failures = match outcome {
            Outcome::Failed => self.failures + 1,
            Outcome::Answered => 0,
        };
        if self.beat_again {
            self.beat_again = false;
            self.beat_now(now);
        } else {
            self.due_at = Some(now + next_delay_ms(self.failures));
        }
        Finished::Counted
    }
}

/// Why a beat did not go through, as the thread needs to tell them apart.
#[derive(Debug, PartialEq, Eq)]
pub enum PulseError {
    /// The hub no longer accepts the sign-in.
    SignedOut { host: String },
    /// The hub refused this machine for a reason waiting will not mend, in its words.
    Refused(String),
    /// Anything else: the beat is tried again after the backoff.
    Failed(String),
}

/// What makes the request of a beat; the hub in the app, a fake in a test.
pub trait Pulse: Send + Sync {
    fn beat(&self, presence: &Presence) -> Result<(), PulseError>;
}

/// A [`Pulse`] over the hub: `PUT /machines/:id`. The remote can be replaced after a new sign-in.
pub struct HubPulse {
    remote: Mutex<Arc<Remote>>,
    machine: Machine,
}

impl HubPulse {
    pub fn new(remote: Arc<Remote>, machine: Machine) -> Self {
        HubPulse {
            remote: Mutex::new(remote),
            machine,
        }
    }

    /// Beats with `remote` from now on.
    pub fn replace(&self, remote: Arc<Remote>) {
        *self.remote.lock().unwrap_or_else(|p| p.into_inner()) = remote;
    }
}

impl Pulse for HubPulse {
    fn beat(&self, presence: &Presence) -> Result<(), PulseError> {
        let remote = self
            .remote
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        match beat(&remote, &self.machine, presence) {
            Ok(_) => Ok(()),
            Err(RemoteError::SignedOut { host }) => Err(PulseError::SignedOut { host }),
            Err(RemoteError::Refused {
                status: 400 | 403 | 409,
                message,
                ..
            }) => Err(PulseError::Refused(message)),
            Err(other) => Err(PulseError::Failed(other.to_string())),
        }
    }
}

/// What a beat reports, read as it goes out.
pub type Report = Arc<dyn Fn() -> Presence + Send + Sync>;

struct Shared {
    beater: Mutex<Beater>,
    changed: Condvar,
    stop: Mutex<bool>,
}

impl Shared {
    fn beater(&self) -> MutexGuard<'_, Beater> {
        self.beater
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// How long the thread sleeps between looks at the clock, which a test owns.
const LOOK: Duration = Duration::from_millis(100);

/// The clock moved this much further than the machine's uptime clock: the machine slept. Uptime clocks stop in
/// sleep, so the difference is the time asleep.
const SLEPT_MS: i64 = 10_000;

/// Whether the wall clock ran `wall_ms` while the monotonic clock ran `monotonic_ms` over the same stretch means the
/// machine slept through the difference.
pub fn slept(wall_ms: i64, monotonic_ms: i64) -> bool {
    wall_ms - monotonic_ms >= SLEPT_MS
}

fn wall_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as i64)
}

fn work(
    shared: Arc<Shared>,
    pulse: Arc<dyn Pulse>,
    report: Report,
    clock: Arc<dyn Clock>,
    events: Sender<DaemonEvent>,
) {
    let mut looked = (Instant::now(), wall_ms());
    let mut told_refusal: Option<String> = None;
    loop {
        if *shared.stop.lock().unwrap_or_else(|p| p.into_inner()) {
            return;
        }
        let (mono, wall) = (Instant::now(), wall_ms());
        let (last_mono, last_wall) = looked;
        looked = (mono, wall);
        let ticket = {
            let mut beater = shared.beater();
            if slept(
                wall - last_wall,
                mono.duration_since(last_mono).as_millis() as i64,
            ) {
                beater.wake(clock.now_ms());
            }
            beater.poll(clock.now_ms())
        };
        let Some(ticket) = ticket else {
            let stop = shared.stop.lock().unwrap_or_else(|p| p.into_inner());
            let _ = shared.changed.wait_timeout(stop, LOOK);
            continue;
        };
        let result = pulse.beat(&report());
        let outcome = match &result {
            Ok(()) => Outcome::Answered,
            Err(_) => Outcome::Failed,
        };
        let finished = {
            let mut beater = shared.beater();
            let finished = beater.finish(ticket, clock.now_ms(), outcome);
            if finished == Finished::Counted
                && let Err(PulseError::SignedOut { .. }) = &result
            {
                beater.stop();
            }
            finished
        };
        if finished == Finished::Stale {
            continue;
        }
        match result {
            Ok(()) => told_refusal = None,
            Err(PulseError::SignedOut { host }) => {
                let _ = events.send(DaemonEvent::SignedOut { host });
            }
            Err(PulseError::Refused(message)) => {
                if told_refusal.as_ref() != Some(&message) {
                    told_refusal = Some(message.clone());
                    let _ = events.send(DaemonEvent::MachineRefused { message });
                }
            }
            Err(PulseError::Failed(_)) => {}
        }
    }
}

/// The beat running on its thread. Dropping it stops the thread.
pub struct Beat {
    shared: Arc<Shared>,
    clock: Arc<dyn Clock>,
    thread: Option<JoinHandle<()>>,
}

impl Beat {
    /// Starts beating at once. `report` is read each time a beat goes out; `events` hears
    /// [`DaemonEvent::SignedOut`] and [`DaemonEvent::MachineRefused`].
    pub fn start(
        pulse: Arc<dyn Pulse>,
        report: Report,
        clock: Arc<dyn Clock>,
        events: Sender<DaemonEvent>,
    ) -> Beat {
        let mut beater = Beater::new();
        beater.start(clock.now_ms());
        let shared = Arc::new(Shared {
            beater: Mutex::new(beater),
            changed: Condvar::new(),
            stop: Mutex::new(false),
        });
        let thread = {
            let shared = shared.clone();
            let clock = clock.clone();
            thread::spawn(move || work(shared, pulse, report, clock, events))
        };
        Beat {
            shared,
            clock,
            thread: Some(thread),
        }
    }

    /// A beat now, outside the interval: the open set changed.
    pub fn beat_now(&self) {
        self.shared.beater().beat_now(self.clock.now_ms());
        self.shared.changed.notify_one();
    }

    /// The machine woke from sleep: beat now and forget any backoff.
    pub fn wake(&self) {
        self.shared.beater().wake(self.clock.now_ms());
        self.shared.changed.notify_one();
    }

    /// Beats again after [`DaemonEvent::SignedOut`] stopped it, once the app has signed in again.
    pub fn resume(&self) {
        self.shared.beater().start(self.clock.now_ms());
        self.shared.changed.notify_one();
    }

    /// Whether the beat is running (it stops when the hub refuses the sign-in).
    pub fn is_running(&self) -> bool {
        self.shared.beater().is_running()
    }

    /// Stops the thread, waiting for the beat it is in.
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        *self.shared.stop.lock().unwrap_or_else(|p| p.into_inner()) = true;
        self.shared.changed.notify_one();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for Beat {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::sync::mpsc;

    use dit_core::remote::test_support::{MockServer, Recorded, Reply, remote_to};
    use serde_json::json;

    use super::*;
    use crate::test_support::FakeClock;

    #[test]
    fn the_wait_after_failures_doubles_from_five_seconds_to_a_minute() {
        let waits: Vec<i64> = (0..=7).map(next_delay_ms).collect();
        assert_eq!(
            waits,
            [
                30_000, 5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000
            ]
        );
        assert_eq!(next_delay_ms(u32::MAX), 60_000);
    }

    #[test]
    fn a_started_beater_beats_at_once_then_every_thirty_seconds() {
        let mut beater = Beater::new();
        assert_eq!(beater.poll(0), None, "not started");
        beater.start(1_000);
        let ticket = beater.poll(1_000).expect("a beat at once");
        assert_eq!(beater.poll(1_000), None, "one is out");
        assert_eq!(
            beater.finish(ticket, 1_100, Outcome::Answered),
            Finished::Counted
        );
        assert_eq!(beater.poll(31_099), None);
        assert!(beater.poll(31_100).is_some());
    }

    #[test]
    fn backoff_runs_on_the_clock_it_is_given() {
        let mut beater = Beater::new();
        beater.start(0);
        let mut now = 0;
        let mut waited = Vec::new();
        for _ in 0..6 {
            let ticket = beater.poll(now).expect("due");
            beater.finish(ticket, now, Outcome::Failed);
            // The beat is not due one tick before its wait ends and is due at it.
            let wait = next_delay_ms(beater.failures());
            assert_eq!(beater.poll(now + wait - 1), None);
            now += wait;
            waited.push(wait);
        }
        assert_eq!(waited, [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);

        let ticket = beater.poll(now).expect("due");
        beater.finish(ticket, now, Outcome::Answered);
        assert_eq!(beater.failures(), 0);
        assert_eq!(beater.poll(now + 29_999), None);
        assert!(beater.poll(now + 30_000).is_some());
    }

    #[test]
    fn a_change_while_a_beat_is_out_beats_again_as_soon_as_it_is_back() {
        let mut beater = Beater::new();
        beater.start(0);
        let ticket = beater.poll(0).unwrap();
        beater.beat_now(500);
        assert_eq!(beater.poll(500), None, "still one at a time");

        beater.finish(ticket, 800, Outcome::Answered);

        assert!(
            beater.poll(800).is_some(),
            "the report it carried is out of date"
        );
    }

    #[test]
    fn a_change_while_idle_beats_at_once() {
        let mut beater = Beater::new();
        beater.start(0);
        let ticket = beater.poll(0).unwrap();
        beater.finish(ticket, 10, Outcome::Answered);

        beater.beat_now(5_000);

        assert!(beater.poll(5_000).is_some());
    }

    #[test]
    fn waking_forgets_the_backoff_and_beats_now() {
        let mut beater = Beater::new();
        beater.start(0);
        for round in 0..3 {
            let ticket = beater.poll(round * 100_000).unwrap();
            beater.finish(ticket, round * 100_000, Outcome::Failed);
        }
        assert_eq!(beater.failures(), 3);

        beater.wake(400_000);

        assert_eq!(beater.failures(), 0);
        assert!(beater.poll(400_000).is_some());
    }

    #[test]
    fn an_answer_after_a_stop_is_dropped_and_a_restart_keeps_its_owed_beat() {
        let mut beater = Beater::new();
        beater.start(0);
        let ticket = beater.poll(0).unwrap();
        beater.stop();
        beater.start(100);
        beater.beat_now(200);

        assert_eq!(beater.finish(ticket, 300, Outcome::Failed), Finished::Stale);

        assert_eq!(beater.failures(), 0, "the old run's failure does not count");
        assert!(beater.poll(300).is_some(), "the beat the new run asked for");
    }

    #[test]
    fn a_stopped_beater_never_beats() {
        let mut beater = Beater::new();
        beater.start(0);
        beater.stop();
        beater.beat_now(10);
        beater.wake(20);
        assert_eq!(beater.poll(1_000_000), None);
        assert!(!beater.is_running());
    }

    #[test]
    fn a_wall_clock_that_ran_ahead_of_the_uptime_clock_means_the_machine_slept() {
        assert!(!slept(100, 100));
        assert!(!slept(10_099, 100));
        assert!(slept(10_100, 100));
        assert!(slept(3_600_000, 100));
    }

    struct Scripted {
        seen: Mutex<Vec<Presence>>,
        results: Mutex<VecDeque<Result<(), PulseError>>>,
    }

    impl Pulse for Scripted {
        fn beat(&self, presence: &Presence) -> Result<(), PulseError> {
            self.seen.lock().unwrap().push(presence.clone());
            self.results.lock().unwrap().pop_front().unwrap_or(Ok(()))
        }
    }

    fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !done() {
            assert!(Instant::now() < deadline, "timed out waiting for {what}");
            thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn the_thread_beats_with_the_report_read_as_it_goes_out_and_backs_off_on_the_clock() {
        let pulse = Arc::new(Scripted {
            seen: Mutex::default(),
            results: Mutex::new(VecDeque::from([
                Err(PulseError::Failed("down".into())),
                Err(PulseError::Failed("down".into())),
            ])),
        });
        let clock = FakeClock::default();
        clock.set(1_000_000);
        let report_session = Arc::new(Mutex::new(None));
        let report: Report = {
            let session = report_session.clone();
            Arc::new(move || Presence {
                open_session_id: *session.lock().unwrap(),
                repo_ids: vec![3, 9],
            })
        };
        let (events, _heard) = mpsc::channel();
        let beat = Beat::start(pulse.clone(), report, Arc::new(clock.clone()), events);

        wait_for("the first beat", || pulse.seen.lock().unwrap().len() == 1);
        // Failed: the next waits 5 s on the fake clock.
        clock.set(1_004_999);
        thread::sleep(Duration::from_millis(300));
        assert_eq!(pulse.seen.lock().unwrap().len(), 1);
        clock.set(1_005_000);
        wait_for("the retry", || pulse.seen.lock().unwrap().len() == 2);
        // Failed again: 10 s.
        clock.set(1_014_999);
        thread::sleep(Duration::from_millis(300));
        assert_eq!(pulse.seen.lock().unwrap().len(), 2);
        *report_session.lock().unwrap() = Some(812);
        clock.set(1_015_000);
        wait_for("the second retry", || pulse.seen.lock().unwrap().len() == 3);

        // An open-set change beats at once, whatever the interval.
        beat.beat_now();
        wait_for("the nudge", || pulse.seen.lock().unwrap().len() == 4);

        let seen = pulse.seen.lock().unwrap();
        assert_eq!(seen[0].open_session_id, None);
        assert_eq!(seen[2].open_session_id, Some(812));
        assert_eq!(seen[3].repo_ids, [3, 9]);
        drop(seen);
        beat.stop();
    }

    #[test]
    fn a_refused_sign_in_stops_the_beat_and_says_so_once() {
        let pulse = Arc::new(Scripted {
            seen: Mutex::default(),
            results: Mutex::new(VecDeque::from([Err(PulseError::SignedOut {
                host: "hub.test".into(),
            })])),
        });
        let clock = FakeClock::default();
        let (events, heard) = mpsc::channel();
        let beat = Beat::start(
            pulse.clone(),
            Arc::new(Presence::default),
            Arc::new(clock.clone()),
            events,
        );

        let event = heard.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(matches!(event, DaemonEvent::SignedOut { host } if host == "hub.test"));
        wait_for("the stop", || !beat.is_running());
        clock.set(10_000_000);
        thread::sleep(Duration::from_millis(300));
        assert_eq!(pulse.seen.lock().unwrap().len(), 1);

        beat.resume();
        wait_for("the beat after resuming", || {
            pulse.seen.lock().unwrap().len() == 2
        });
        beat.stop();
    }

    #[test]
    fn a_refusal_the_hub_means_is_reported_once_per_message() {
        let pulse = Arc::new(Scripted {
            seen: Mutex::default(),
            results: Mutex::new(VecDeque::from([
                Err(PulseError::Refused("Name taken.".into())),
                Err(PulseError::Refused("Name taken.".into())),
            ])),
        });
        let clock = FakeClock::default();
        let (events, heard) = mpsc::channel();
        let beat = Beat::start(
            pulse.clone(),
            Arc::new(Presence::default),
            Arc::new(clock.clone()),
            events,
        );

        wait_for("the first beat", || pulse.seen.lock().unwrap().len() == 1);
        clock.set(5_000);
        wait_for("the second beat", || pulse.seen.lock().unwrap().len() == 2);
        beat.stop();

        let told: Vec<_> = heard.try_iter().collect();
        assert_eq!(told.len(), 1);
        assert!(matches!(
            &told[0],
            DaemonEvent::MachineRefused { message } if message == "Name taken."
        ));
    }

    #[test]
    fn the_hub_pulse_sends_the_machine_and_what_it_has_open() {
        let server = MockServer::route(|_: &Recorded| {
            Reply::json(
                200,
                json!({"id": "m-1", "name": "Studio", "online": true, "openSessionId": 812})
                    .to_string(),
            )
        });
        let machine = Machine {
            id: "mach-1234567890abcdef".into(),
            name: "Studio".into(),
            platform: "macOS".into(),
            app_version: "0.14.0".into(),
        };
        let pulse = HubPulse::new(Arc::new(remote_to(&server)), machine);

        pulse
            .beat(&Presence {
                open_session_id: Some(812),
                repo_ids: vec![3, 9],
            })
            .unwrap();

        let requests = server.requests();
        assert_eq!(requests[0].method, "PUT");
        assert_eq!(
            requests[0].path_only(),
            "/api/machines/mach-1234567890abcdef"
        );
        assert_eq!(
            requests[0].json(),
            json!({
                "name": "Studio",
                "platform": "macOS",
                "appVersion": "0.14.0",
                "openSessionId": 812,
                "repoIds": [3, 9],
            })
        );
    }

    #[test]
    fn the_hub_pulse_tells_the_refusals_apart() {
        let status = Arc::new(Mutex::new(409u16));
        let server = {
            let status = status.clone();
            MockServer::route(move |_: &Recorded| {
                let status = *status.lock().unwrap();
                Reply::json(
                    status,
                    json!({"error": "That name is taken.", "code": "machine_name_taken"})
                        .to_string(),
                )
            })
        };
        let machine = Machine {
            id: "mach-1234567890abcdef".into(),
            name: "Studio".into(),
            platform: "macOS".into(),
            app_version: "0.14.0".into(),
        };
        let pulse = HubPulse::new(Arc::new(remote_to(&server)), machine);
        let presence = Presence::default();

        assert_eq!(
            pulse.beat(&presence),
            Err(PulseError::Refused("That name is taken.".into()))
        );
        *status.lock().unwrap() = 401;
        assert!(matches!(
            pulse.beat(&presence),
            Err(PulseError::SignedOut { .. })
        ));
        *status.lock().unwrap() = 429;
        assert!(matches!(pulse.beat(&presence), Err(PulseError::Failed(_))));
        *status.lock().unwrap() = 503;
        assert!(matches!(pulse.beat(&presence), Err(PulseError::Failed(_))));
    }
}
