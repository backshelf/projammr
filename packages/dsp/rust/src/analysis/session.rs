//! `Analysis`: one session that receives one interleaved stream and fans it
//! to every analyser its `flags` named, so a host decodes once and taps
//! every figure it wants — peaks, BS.1770 loudness, the long-term average
//! spectrum, (flag bit 3) the live readouts the worklet polls, and (bits 4
//! to 12) the offline analyses computed when the stream finishes.

use super::live::LiveReadouts;
use super::loudness::Loudness;
use super::offline::{self, Offline};
use super::peaks::Peaks;
use super::spectrum::{Spectrum, SpectrumLayout};
use crate::error::DspError;

pub const FLAG_PEAKS: u32 = 1 << 0;
pub const FLAG_LOUDNESS: u32 = 1 << 1;
pub const FLAG_SPECTRUM: u32 = 1 << 2;
pub const FLAG_LIVE: u32 = 1 << 3;

const KNOWN_FLAGS: u32 = FLAG_PEAKS | FLAG_LOUDNESS | FLAG_SPECTRUM | FLAG_LIVE | offline::FLAGS;

pub struct Session {
    rate: u32,
    channels: u32,
    frames: u64,
    flags: u32,
    peaks: Option<Peaks>,
    loudness: Option<Loudness>,
    spectrum: Option<Spectrum>,
    live: Option<LiveReadouts>,
    offline: Offline,
    /// Storage `take_loudness`/`take_spectrum` hand out pointers into, kept
    /// alive by the session between calls as the ABI's `*_ptr` rule requires.
    live_loudness_out: [f32; 3],
    live_spectrum_out: Vec<f32>,
}

impl Session {
    pub fn new(rate: u32, channels: u32, flags: u32) -> Result<Self, DspError> {
        if rate == 0 || channels == 0 {
            return Err(DspError::BadArgument);
        }
        if flags & !KNOWN_FLAGS != 0 {
            return Err(DspError::BadArgument);
        }

        let peaks = (flags & FLAG_PEAKS != 0).then(|| Peaks::new(rate));
        // The offline curves and clipping read the same meter.
        let loudness = if flags & (FLAG_LOUDNESS | offline::LOUDNESS_FLAGS) != 0 {
            Some(Loudness::new(channels, rate)?)
        } else {
            None
        };
        let live = if flags & FLAG_LIVE != 0 {
            Some(LiveReadouts::new(channels, rate)?)
        } else {
            None
        };

        Ok(Self {
            rate,
            channels,
            frames: 0,
            flags,
            peaks,
            loudness,
            spectrum: None,
            live,
            offline: Offline::new(rate, channels, flags),
            live_loudness_out: [0.0; 3],
            live_spectrum_out: Vec::new(),
        })
    }

    pub fn channels(&self) -> u32 {
        self.channels
    }

    /// Feeds one chunk of interleaved samples to every analyser the
    /// session's flags named. `BadArgument` when the sample count is not a
    /// multiple of the channel count, or when flag bit 2 (spectrum) is set
    /// but `set_spectrum_layout` has not configured it yet.
    pub fn push(&mut self, interleaved: &[f32]) -> Result<(), DspError> {
        if !interleaved.len().is_multiple_of(self.channels as usize) {
            return Err(DspError::BadArgument);
        }
        if self.flags & FLAG_SPECTRUM != 0 && self.spectrum.is_none() {
            return Err(DspError::BadArgument);
        }

        self.frames += (interleaved.len() / self.channels as usize) as u64;
        if let Some(peaks) = &mut self.peaks {
            peaks.push(interleaved, self.channels);
        }
        if self.offline.feeds_loudness() {
            self.offline.push(interleaved, self.loudness.as_mut());
        } else {
            if let Some(loudness) = &mut self.loudness {
                loudness.push(interleaved);
            }
            self.offline.push(interleaved, None);
        }
        if let Some(spectrum) = &mut self.spectrum {
            spectrum.push(interleaved, self.channels);
        }
        if let Some(live) = &mut self.live {
            live.push(interleaved, self.channels);
        }
        Ok(())
    }

    /// Flushes peaks' trailing partial bin and runs the offline analysers
    /// (only the first call does). The spectrum average needs no flush:
    /// `spectrum_ptr`/`spectrum_len` recompute it fresh on every call, so it
    /// is already current before this ever runs.
    pub fn finish(&mut self) -> Result<(), DspError> {
        if let Some(peaks) = &mut self.peaks {
            peaks.finish();
        }
        let duration_ms = (self.frames as f64 * 1000.0 / f64::from(self.rate)) as f32;
        self.offline.finish(duration_ms, self.loudness.as_ref());
        Ok(())
    }

    /// The offline analyses' results, filled by `finish`.
    pub fn offline(&self) -> &Offline {
        &self.offline
    }

    /// The loudness getters answer only for a session that asked for them,
    /// even when the offline curves run the meter.
    fn loudness(&self) -> Option<&Loudness> {
        self.loudness
            .as_ref()
            .filter(|_| self.flags & FLAG_LOUDNESS != 0)
    }

    pub fn frames(&self) -> u64 {
        self.frames
    }

    pub fn peaks_ptr(&self) -> *const f32 {
        self.peaks
            .as_ref()
            .map_or(std::ptr::null(), |peaks| peaks.values().as_ptr())
    }

    pub fn peaks_len(&self) -> u32 {
        self.peaks
            .as_ref()
            .map_or(0, |peaks| peaks.values().len() as u32)
    }

    pub fn lufs(&self) -> f64 {
        self.loudness()
            .map_or(f64::NEG_INFINITY, Loudness::integrated)
    }

    pub fn lra(&self) -> f64 {
        self.loudness().map_or(0.0, Loudness::range)
    }

    pub fn true_peak_db(&self) -> f64 {
        self.loudness()
            .map_or(f64::NEG_INFINITY, Loudness::true_peak_db)
    }

    /// The long-term average, recomputed fresh from every window fed so
    /// far; `None` before the first full window or without the spectrum
    /// flag, never a stale or default reading.
    fn spectrum_average(&mut self) -> Option<&[f32]> {
        self.spectrum.as_mut()?.average()
    }

    pub fn spectrum_ptr(&mut self) -> *const f32 {
        self.spectrum_average()
            .map_or(std::ptr::null(), |average| average.as_ptr())
    }

    pub fn spectrum_len(&mut self) -> u32 {
        self.spectrum_average()
            .map_or(0, |average| average.len() as u32)
    }

    /// One `f32` layout call configures the session's spectrum analyser,
    /// which stays absent (and `push` refuses flag bit 2) until this
    /// succeeds. Must run before the first `push`.
    pub fn set_spectrum_layout(
        &mut self,
        bands: u32,
        low_hz: f32,
        high_hz: f32,
        fft_size: u32,
        tilt_db_per_octave: f32,
        floor_db: f32,
    ) -> Result<(), DspError> {
        if self.flags & FLAG_SPECTRUM == 0 || self.frames != 0 {
            return Err(DspError::BadArgument);
        }
        let layout = SpectrumLayout {
            bands: bands as usize,
            low_hz: f64::from(low_hz),
            high_hz: f64::from(high_hz),
            fft_size: fft_size as usize,
            tilt_db_per_octave: f64::from(tilt_db_per_octave),
            floor_db: f64::from(floor_db),
        };
        self.spectrum = Some(Spectrum::new(self.rate, layout)?);
        Ok(())
    }

    /// A pointer to the newest closed 10 ms hop's momentary LUFS,
    /// short-term LUFS and sample peak (dBFS), or `None` when no hop has
    /// closed since the last call.
    pub fn take_loudness(&mut self) -> Option<*const f32> {
        let hop = self.live.as_mut()?.take()?;
        self.live_loudness_out = hop;
        Some(self.live_loudness_out.as_ptr())
    }

    /// A pointer to the newest spectrum window's 96 band levels, or `None`
    /// when no window has closed since the last call. Requires both flag
    /// bit 3 (live) and flag bit 2 (spectrum, through `set_spectrum_layout`).
    pub fn take_spectrum(&mut self) -> Option<*const f32> {
        if self.flags & FLAG_LIVE == 0 {
            return None;
        }
        let bands = self.spectrum.as_mut()?.take_latest()?.to_vec();
        self.live_spectrum_out = bands;
        Some(self.live_spectrum_out.as_ptr())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    fn spectrum_layout_args() -> (u32, f32, f32, u32, f32, f32) {
        (96, 20.0, 20_000.0, 8192, 4.5, -120.0)
    }

    #[test]
    fn a_flag_bit_above_the_offline_analysers_is_rejected_as_bad_argument() {
        assert_eq!(
            Session::new(RATE, 1, FLAG_PEAKS | (1 << 13)).err(),
            Some(DspError::BadArgument)
        );
        assert!(Session::new(RATE, 1, offline::FLAGS).is_ok());
    }

    #[test]
    fn the_offline_curves_leave_the_loudness_getters_unset_without_their_flag() {
        let mut session = Session::new(RATE, 2, offline::FLAG_CURVES).unwrap();
        session.push(&vec![0.5; RATE as usize * 2]).unwrap();
        session.finish().unwrap();
        assert_eq!(session.lufs(), f64::NEG_INFINITY);
        let curve = session.offline().timeline().unwrap().loudness_curve();
        assert_eq!(curve.len(), 1);
    }

    #[test]
    fn every_offline_analysis_reads_one_stream_and_reports_after_finish() {
        let mut session = Session::new(RATE, 2, FLAG_LOUDNESS | offline::FLAGS).unwrap();
        let mut signal = vec![0.0f32; RATE as usize * 2 * 12];
        for (i, frame) in signal.chunks_exact_mut(2).enumerate() {
            let t = i as f32 / RATE as f32;
            let tone = 0.3 * (core::f32::consts::TAU * 220.0 * t).sin();
            let click = if i % (RATE as usize / 2) < 10 {
                0.5
            } else {
                0.0
            };
            frame.fill(tone + click);
        }
        for chunk in signal.chunks(9000) {
            session.push(chunk).unwrap();
        }
        assert!(session.offline().tempo().is_none());
        assert!(session.offline().pitch_track().is_empty());
        session.finish().unwrap();

        let offline = session.offline();
        assert!(offline.tempo().is_some_and(|t| (t[0] - 120.0).abs() <= 0.5));
        assert!(offline.key().is_some());
        assert!(!offline.sections().is_empty());
        assert_eq!(offline.spectrogram().len(), 240 * 160);
        let timeline = offline.timeline().unwrap();
        assert_eq!(timeline.loudness_curve().len(), 12);
        assert_eq!(timeline.correlation_curve(), [1.0; 12]);
        assert_eq!(timeline.silence(), &[0.0, 0.0]);
        assert_eq!(offline.pitch_track().len(), 240);
        assert_eq!(
            offline.feature(offline::diff::Series::Onset).bytes.len(),
            1200
        );
        assert_eq!(
            offline.feature(offline::diff::Series::Mel).bytes.len(),
            12 * 40
        );
        assert_eq!(
            offline.feature(offline::diff::Series::Chroma).bytes.len(),
            12 * 12
        );
        assert!(session.lufs().is_finite());
    }

    #[test]
    fn zero_rate_or_channels_is_rejected() {
        assert_eq!(Session::new(0, 1, 0).err(), Some(DspError::BadArgument));
        assert_eq!(Session::new(RATE, 0, 0).err(), Some(DspError::BadArgument));
    }

    #[test]
    fn frames_and_duration_track_every_pushed_sample() {
        let mut session = Session::new(RATE, 1, 0).unwrap();
        assert_eq!(session.push(&[0.0; 100]), Ok(()));
        assert_eq!(session.push(&[0.0; 50]), Ok(()));
        assert_eq!(session.frames(), 150);
    }

    #[test]
    fn a_frame_count_that_is_not_a_multiple_of_channels_is_bad_argument() {
        let mut session = Session::new(RATE, 2, 0).unwrap();
        assert_eq!(session.push(&[0.0; 3]), Err(DspError::BadArgument));
    }

    #[test]
    fn pushing_before_the_spectrum_layout_is_set_fails() {
        let mut session = Session::new(RATE, 1, FLAG_SPECTRUM).unwrap();
        assert_eq!(session.push(&[0.0; 10]), Err(DspError::BadArgument));
    }

    #[test]
    fn the_spectrum_layout_requires_the_spectrum_flag() {
        let mut session = Session::new(RATE, 1, FLAG_PEAKS).unwrap();
        let (bands, low, high, fft, tilt, floor) = spectrum_layout_args();
        assert_eq!(
            session.set_spectrum_layout(bands, low, high, fft, tilt, floor),
            Err(DspError::BadArgument)
        );
    }

    #[test]
    fn the_spectrum_layout_cannot_change_after_the_first_push() {
        let mut session = Session::new(RATE, 1, FLAG_SPECTRUM).unwrap();
        let (bands, low, high, fft, tilt, floor) = spectrum_layout_args();
        assert_eq!(
            session.set_spectrum_layout(bands, low, high, fft, tilt, floor),
            Ok(())
        );
        assert_eq!(session.push(&vec![0.0; fft as usize]), Ok(()));
        assert_eq!(
            session.set_spectrum_layout(bands, low, high, fft, tilt, floor),
            Err(DspError::BadArgument)
        );
    }

    #[test]
    fn take_loudness_reports_nothing_without_the_live_flag() {
        let mut session = Session::new(RATE, 1, FLAG_LOUDNESS).unwrap();
        assert_eq!(session.push(&vec![0.5; RATE as usize]), Ok(()));
        assert!(session.take_loudness().is_none());
    }

    #[test]
    fn take_spectrum_reports_nothing_without_the_live_flag_even_with_a_layout() {
        let mut session = Session::new(RATE, 1, FLAG_SPECTRUM).unwrap();
        let (bands, low, high, fft, tilt, floor) = spectrum_layout_args();
        session
            .set_spectrum_layout(bands, low, high, fft, tilt, floor)
            .unwrap();
        session.push(&vec![0.5; fft as usize]).unwrap();
        assert!(session.take_spectrum().is_none());
    }

    #[test]
    fn take_spectrum_reports_a_hop_once_live_and_spectrum_are_both_set() {
        let mut session = Session::new(RATE, 1, FLAG_SPECTRUM | FLAG_LIVE).unwrap();
        let (bands, low, high, fft, tilt, floor) = spectrum_layout_args();
        session
            .set_spectrum_layout(bands, low, high, fft, tilt, floor)
            .unwrap();
        session.push(&vec![0.5; fft as usize]).unwrap();
        assert!(session.take_spectrum().is_some());
        assert!(session.take_spectrum().is_none());
    }

    #[test]
    fn finish_leaves_peaks_final() {
        let mut session = Session::new(RATE, 1, FLAG_PEAKS).unwrap();
        session.push(&vec![0.5; RATE as usize / 40]).unwrap();
        assert_eq!(session.peaks_len(), 0);
        session.finish().unwrap();
        assert_eq!(session.peaks_len(), 1);
    }

    #[test]
    fn spectrum_average_is_current_on_every_call_without_a_finish() {
        let mut session = Session::new(RATE, 1, FLAG_SPECTRUM).unwrap();
        let (bands, low, high, fft, tilt, floor) = spectrum_layout_args();
        session
            .set_spectrum_layout(bands, low, high, fft, tilt, floor)
            .unwrap();

        assert_eq!(session.spectrum_len(), 0);
        assert!(session.spectrum_ptr().is_null());

        let mut signal = vec![0.0f32; RATE as usize];
        for (i, sample) in signal.iter_mut().enumerate() {
            *sample = 0.5 * (2.0 * core::f32::consts::PI * 440.0 * i as f32 / RATE as f32).sin();
        }
        session.push(&signal).unwrap();

        // A full window closed without calling `finish`, so the getters must
        // already report it rather than a null pointer or a stale default.
        assert_eq!(session.spectrum_len(), bands);
        assert!(!session.spectrum_ptr().is_null());
        let first_len = session.spectrum_len();
        let first = unsafe {
            std::slice::from_raw_parts(session.spectrum_ptr(), first_len as usize).to_vec()
        };
        assert!(first.iter().any(|&db| db > floor));
    }
}
