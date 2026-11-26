//! Live loudness for the worklet (flag bit 3, C6): momentary and short-term
//! LUFS plus the sample peak, refreshed once per 10 ms hop.
//!
//! `ebur128`'s windows are zero-filled ring buffers, so every reading goes
//! through [`primed_lufs`]: the meter comes up from the first 10 ms rather
//! than sitting at the floor for 400 ms (momentary) or 3 s (short-term).

use ebur128::{EbuR128, Mode};

use super::loudness::{primed_lufs, window_frames};
use crate::error::DspError;

/// Momentary LUFS, short-term LUFS and sample peak in dBFS, refreshed once
/// per closed 10 ms hop.
pub type LoudnessHop = [f32; 3];

pub struct LiveReadouts {
    meter: EbuR128,
    hop_frames: u64,
    frames_since_hop: u64,
    frames_total: u64,
    momentary_window: u64,
    shortterm_window: u64,
    hop_peak: f32,
    pending: Option<LoudnessHop>,
}

impl LiveReadouts {
    pub fn new(channels: u32, rate: u32) -> Result<Self, DspError> {
        // `Mode::S` already implies `Mode::M`.
        let meter = EbuR128::new(channels, rate, Mode::S).map_err(|_| DspError::BadArgument)?;
        let hop_frames = (f64::from(rate) * 0.01).round().max(1.0) as u64;
        Ok(Self {
            meter,
            hop_frames,
            frames_since_hop: 0,
            frames_total: 0,
            momentary_window: window_frames(rate, 4),
            shortterm_window: window_frames(rate, 30),
            hop_peak: 0.0,
            pending: None,
        })
    }

    /// Feeds interleaved samples, closing every 10 ms hop the buffer
    /// completes. Only the newest closed hop survives until `take`; a hop
    /// closed before the previous one is read is overwritten, not queued.
    pub fn push(&mut self, interleaved: &[f32], channels: u32) {
        let channels = channels as usize;
        if channels == 0 {
            return;
        }
        let total_frames = interleaved.len() / channels;
        let mut offset = 0;
        while offset < total_frames {
            let remaining_in_hop = (self.hop_frames - self.frames_since_hop) as usize;
            let take = remaining_in_hop.min(total_frames - offset);
            let chunk = &interleaved[offset * channels..(offset + take) * channels];

            for &sample in chunk {
                let magnitude = sample.abs();
                if magnitude > self.hop_peak {
                    self.hop_peak = magnitude;
                }
            }
            // A well-formed chunk (a multiple of the channel count) cannot
            // fail `add_frames_f32`.
            let _ = self.meter.add_frames_f32(chunk);

            self.frames_since_hop += take as u64;
            self.frames_total += take as u64;
            offset += take;

            if self.frames_since_hop == self.hop_frames {
                self.close_hop();
            }
        }
    }

    /// The newest closed hop, or `None` when no hop has closed since the
    /// last call.
    pub fn take(&mut self) -> Option<LoudnessHop> {
        self.pending.take()
    }

    fn close_hop(&mut self) {
        let momentary = self.corrected_lufs(
            self.meter.loudness_momentary().unwrap_or(f64::NEG_INFINITY),
            self.momentary_window,
        );
        let short_term = self.corrected_lufs(
            self.meter.loudness_shortterm().unwrap_or(f64::NEG_INFINITY),
            self.shortterm_window,
        );
        let peak = if self.hop_peak > 0.0 {
            20.0 * f64::from(self.hop_peak).log10()
        } else {
            f64::NEG_INFINITY
        };
        self.pending = Some([momentary as f32, short_term as f32, peak as f32]);
        self.hop_peak = 0.0;
        self.frames_since_hop = 0;
    }

    fn corrected_lufs(&self, raw: f64, window_frames: u64) -> f64 {
        primed_lufs(raw, window_frames, self.frames_total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    fn sine_stereo(hz: f32, amplitude: f32, frames: usize) -> Vec<f32> {
        let mut interleaved = Vec::with_capacity(frames * 2);
        for i in 0..frames {
            let sample =
                amplitude * (2.0 * core::f32::consts::PI * hz * i as f32 / RATE as f32).sin();
            interleaved.push(sample);
            interleaved.push(sample);
        }
        interleaved
    }

    #[test]
    fn no_hop_closes_before_ten_milliseconds_of_audio() {
        let mut live = LiveReadouts::new(2, RATE).unwrap();
        live.push(&sine_stereo(1000.0, 0.5, 479), 2);
        assert!(live.take().is_none());
    }

    #[test]
    fn the_first_hop_closes_at_ten_milliseconds_and_rises_from_it_not_the_floor() {
        let mut live = LiveReadouts::new(2, RATE).unwrap();
        live.push(&sine_stereo(1000.0, 0.5, 480), 2);
        let hop = live.take().expect("a hop closed at 480 frames");

        // A window zero-padded to 400 ms/3 s would read tens of dB quieter
        // than the level a single filled 10 ms hop of this sine reads at.
        assert!(hop[0] > -20.0, "momentary {}", hop[0]);
        assert!(hop[1] > -20.0, "short-term {}", hop[1]);
    }

    #[test]
    fn only_the_newest_hop_survives_between_takes() {
        let mut live = LiveReadouts::new(2, RATE).unwrap();
        live.push(&sine_stereo(1000.0, 0.5, 480 * 3), 2);
        assert!(live.take().is_some());
        assert!(live.take().is_none());
    }

    #[test]
    fn peak_reports_the_loudest_sample_since_the_last_hop_in_dbfs() {
        let mut live = LiveReadouts::new(1, RATE).unwrap();
        let mut hop = vec![0.0f32; 480];
        hop[10] = 0.5;
        live.push(&hop, 1);
        let readout = live.take().unwrap();
        assert!(
            (readout[2] - 20.0 * 0.5f32.log10()).abs() < 0.01,
            "{}",
            readout[2]
        );
    }

    #[test]
    fn silence_gates_to_negative_infinity() {
        let mut live = LiveReadouts::new(2, RATE).unwrap();
        live.push(&vec![0.0; 480 * 2], 2);
        let hop = live.take().unwrap();
        assert_eq!(
            hop,
            [f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY]
        );
    }

    #[test]
    fn a_fully_primed_short_term_window_matches_the_offline_short_term_reading() {
        let mut live = LiveReadouts::new(2, RATE).unwrap();
        // More than 3 s primes the short-term window fully, so the window/
        // filled correction becomes a no-op (log10(1) == 0).
        let signal = sine_stereo(1000.0, 0.5, RATE as usize * 4);
        let mut last = None;
        for chunk in signal.chunks(480 * 2) {
            live.push(chunk, 2);
            if let Some(hop) = live.take() {
                last = Some(hop);
            }
        }
        let hop = last.unwrap();
        assert!((hop[1] - -6.0).abs() < 0.2, "short-term {}", hop[1]);
    }
}
