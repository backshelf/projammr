//! Renders: audio files a producer bounces beside their projects, proposed to the hub as versions of a track.
//!
//! The pure rules ([`rules`], [`score`], [`probe`]) decide what a file is worth; [`ledger`] remembers what dit found
//! and what the producer said; [`upload`] and [`driver`] add a file to the hub step by step; [`engine`] follows files
//! from their first event to a proposal; [`service`] runs it on threads beside the watcher; [`event`] is the card the
//! panel shows.

pub mod driver;
pub mod engine;
pub mod event;
pub mod ledger;
pub mod probe;
pub mod rejections;
pub mod rules;
pub mod scan;
pub mod score;
pub mod service;
pub mod upload;

#[cfg(test)]
mod test_hub;

pub use event::{RenderEvent, RenderFile, RenderProgress, RenderState};
pub use rules::EXCLUDED_NAMES;
pub use service::{RenderControl, RenderOptions};
