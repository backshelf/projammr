//! Bringing the projects a producer already has into dit: finding their folders ([`discover`]), reading each into its
//! `.dit/` and proposing where its sets go on the hub ([`run`], [`propose`]), and the run that records, binds and sends
//! them folder by folder, resumable and pausable ([`driver`], [`state`]).

pub mod discover;
pub mod driver;
pub mod propose;
pub mod run;
pub mod state;

#[cfg(test)]
mod driver_tests;
#[cfg(test)]
mod test_hub;

pub use discover::{ProjectFacts, find_projects, project_facts, synced_by};
pub use dit_core::remote::SetTarget;
pub use driver::{Alone, BackfillControl, BackfillError, Config, Control, Driver, Event, Owner};
pub use run::{CheckError, Checked, CheckedSet, Doubt, Recorder, Storage, check, discard, storage};
pub use state::{
    FolderPlan, FolderState, FolderStatus, Plan, RunLock, RunStatus, SetPlan, State, Summary,
    Totals,
};
