//! The machine waking and going to sleep. On waking the daemon beats to the hub at once and forgets any backoff, as its
//! connection may have gone while the lid was shut. On going to sleep a backfill run pauses: its upload would only
//! fail, and the person carries it on.

use std::ptr::NonNull;
use std::sync::Arc;

use block2::RcBlock;
use objc2_app_kit::{
    NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
};
use objc2_foundation::{NSNotification, NSNotificationName};
use tauri::{AppHandle, Manager};

use crate::core::Core;

/// Has the core told on every wake and every going to sleep, for the rest of the run.
pub fn observe(app: &AppHandle) {
    // SAFETY: both names are AppKit's own constants.
    let (woke, sleeps) = unsafe {
        (
            NSWorkspaceDidWakeNotification,
            NSWorkspaceWillSleepNotification,
        )
    };
    tell(app, woke, Core::wake);
    tell(app, sleeps, Core::sleep);
}

/// Calls `act` on the core for each notification `name` the workspace posts.
fn tell(app: &AppHandle, name: &'static NSNotificationName, act: fn(&Core)) {
    let handle = app.clone();
    let block = RcBlock::new(move |_: NonNull<NSNotification>| {
        if let Some(core) = handle.try_state::<Arc<Core>>() {
            act(&core);
        }
    });
    let center = NSWorkspace::sharedWorkspace().notificationCenter();
    // SAFETY: no object or queue filter is given, so the block runs on the thread that posts the notification, and
    // it only sends a message to the daemon's thread or sets a flag.
    let observer = unsafe {
        center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block)
    };
    // The centre stops delivering when the token it handed back is dropped; this one lives as long as the app.
    std::mem::forget(observer);
}
