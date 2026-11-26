//! What the dit app does that is not a window: the parts that watch, count and decide, written so a test can drive
//! them with the clock in its hand and no Live, no screen and no network.
//!
//! [`daemon::Daemon`] is the whole of it as one state machine fed [`event::Input`]s and answering with
//! [`event::DaemonEvent`]s; [`runner::start`] puts it on a worker thread beside the filesystem watcher, the script
//! listener and the pollers. The pieces are public for the app shell and for the render watcher, which shares the
//! watcher through [`fswatch::Fswatch::subscribe`].

pub mod backfill;
pub mod bar;
pub mod beat;
pub mod catchup;
pub mod checkpoint;
pub mod daemon;
pub mod event;
pub mod fswatch;
mod jsonfile;
pub mod openset;
pub mod queue;
pub mod renders;
pub mod route;
pub mod runner;
pub mod script;
pub mod segments;
pub mod settle;
pub mod title;

#[cfg(test)]
mod test_support;

use std::time::{SystemTime, UNIX_EPOCH};

pub use daemon::{Config, Daemon};
pub use event::{DaemonEvent, Input};
pub use renders::{RenderEvent, RenderState};

/// Milliseconds since the epoch. Injected so tests own the time.
pub trait Clock: Send + Sync {
    fn now_ms(&self) -> i64;
}

pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_millis() as i64)
    }
}
