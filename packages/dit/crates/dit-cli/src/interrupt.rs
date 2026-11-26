//! Ctrl-C during `dit backfill`: the run pauses after the step it is in, and its state file keeps its place, instead of
//! the process ending in the middle of a push.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

use dit_daemon::backfill::BackfillControl;

/// Set by the signal handler, read by [`watch`].
static INTERRUPTED: AtomicBool = AtomicBool::new(false);

/// How often [`watch`] looks for an interrupt.
const POLL: Duration = Duration::from_millis(50);

/// While it lives, Ctrl-C is noted for [`watch`] and does not end the process. Dropping it gives Ctrl-C back its
/// default meaning.
pub struct Catching;

impl Catching {
    pub fn start() -> Self {
        INTERRUPTED.store(false, Ordering::SeqCst);
        #[cfg(unix)]
        {
            extern "C" fn note(_: libc::c_int) {
                INTERRUPTED.store(true, Ordering::SeqCst);
            }
            // SAFETY: `note` only stores to an atomic, which a signal handler may do.
            unsafe {
                libc::signal(libc::SIGINT, note as *const () as libc::sighandler_t);
            }
        }
        Catching
    }
}

impl Drop for Catching {
    fn drop(&mut self) {
        #[cfg(unix)]
        // SAFETY: restoring the default disposition.
        unsafe {
            libc::signal(libc::SIGINT, libc::SIG_DFL);
        }
    }
}

/// Pauses `control` when Ctrl-C is noted, until `finished` is set.
pub fn watch(control: &dyn BackfillControl, finished: &AtomicBool) {
    while !finished.load(Ordering::SeqCst) {
        if INTERRUPTED.swap(false, Ordering::SeqCst) {
            control.pause();
        }
        thread::sleep(POLL);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use dit_daemon::backfill::{BackfillError, Event, Plan, RunStatus, Summary};

    use super::*;

    #[derive(Default)]
    struct Counting(AtomicUsize);

    impl BackfillControl for Counting {
        fn start(&self, _: Plan, _: &mut dyn FnMut(Event)) -> Result<Summary, BackfillError> {
            unreachable!()
        }
        fn status(&self) -> Result<Option<RunStatus>, BackfillError> {
            Ok(None)
        }
        fn pause(&self) {
            self.0.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn a_noted_interrupt_pauses_the_run_once_and_the_watcher_ends_when_finished() {
        let control = Counting::default();
        let finished = AtomicBool::new(false);
        INTERRUPTED.store(true, Ordering::SeqCst);

        thread::scope(|scope| {
            scope.spawn(|| watch(&control, &finished));
            while control.0.load(Ordering::SeqCst) == 0 {
                thread::sleep(Duration::from_millis(10));
            }
            finished.store(true, Ordering::SeqCst);
        });

        assert_eq!(control.0.load(Ordering::SeqCst), 1);
        assert!(!INTERRUPTED.load(Ordering::SeqCst));
    }
}
