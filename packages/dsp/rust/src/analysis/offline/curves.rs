//! Measurements over the timeline of the interleaved stream: short-term
//! loudness and L/R correlation per second (E6, E7), clipping per 50 ms bin
//! (E8), and the leading and trailing silence (E9).

use crate::analysis::loudness::Loudness;

/// A sample at or above this magnitude is at full scale.
const CLIP_LEVEL: f32 = 0.999;
/// Consecutive full-scale frames that count as a clip.
const CLIP_RUN: u32 = 3;
/// A 50 ms bin whose mean square stays below −60 dBFS is silent.
const SILENT_MEAN_SQUARE: f64 = 1e-6;

/// What a [`Timeline`] measures.
#[derive(Clone, Copy)]
pub struct Measures {
    pub curves: bool,
    pub clipping: bool,
    pub silence: bool,
}

/// Running sums for one second's Pearson correlation of L and R.
#[derive(Default)]
struct Correlation {
    l: f64,
    r: f64,
    ll: f64,
    rr: f64,
    lr: f64,
    n: f64,
}

impl Correlation {
    /// −1..1, two decimals; 1 when both channels are constant (a silent or
    /// mono second), 0 when only one is.
    fn value(&self) -> f32 {
        let n = self.n.max(1.0);
        let var_l = self.ll - self.l * self.l / n;
        let var_r = self.rr - self.r * self.r / n;
        let quiet = |var: f64, sq: f64| var <= 1e-12 * sq.max(1e-12);
        let value = match (quiet(var_l, self.ll), quiet(var_r, self.rr)) {
            (true, true) => 1.0,
            (true, false) | (false, true) => 0.0,
            _ => (self.lr - self.l * self.r / n) / (var_l * var_r).sqrt(),
        };
        ((value.clamp(-1.0, 1.0) * 100.0).round() / 100.0) as f32
    }
}

pub struct Timeline {
    rate: u32,
    channels: usize,
    measures: Measures,
    bin_frames: u32,
    bin_fill: u32,
    bin_index: u32,
    bin_square: f64,
    bin_clipped: u32,
    bin_over: bool,
    run: u32,
    second_fill: u32,
    correlation: Correlation,
    first_sound: Option<u32>,
    last_sound: Option<u32>,
    frames: u64,
    loudness_curve: Vec<f32>,
    correlation_curve: Vec<f32>,
    clipping: Vec<f32>,
    silence: [f32; 2],
}

impl Timeline {
    pub fn new(rate: u32, channels: u32, measures: Measures) -> Self {
        Self {
            rate,
            channels: channels as usize,
            measures,
            // The peaks' bin, so clipping bin indices line up with them.
            bin_frames: (rate / 20).max(1),
            bin_fill: 0,
            bin_index: 0,
            bin_square: 0.0,
            bin_clipped: 0,
            bin_over: false,
            run: 0,
            second_fill: 0,
            correlation: Correlation::default(),
            first_sound: None,
            last_sound: None,
            frames: 0,
            loudness_curve: Vec::new(),
            correlation_curve: Vec::new(),
            clipping: Vec::new(),
            silence: [0.0; 2],
        }
    }

    pub fn measures(&self) -> Measures {
        self.measures
    }

    /// Whether the timeline reads the session's loudness meter, and so
    /// feeds it: short-term loudness per second and true peak per bin.
    pub fn needs_loudness(&self) -> bool {
        self.measures.curves || self.measures.clipping
    }

    /// Measures `interleaved` and feeds `loudness` with it, split at every
    /// bin and second boundary so each reading covers exactly its span.
    pub fn push(&mut self, interleaved: &[f32], mut loudness: Option<&mut Loudness>) {
        let mut rest = interleaved;
        while !rest.is_empty() {
            let span = (self.bin_frames - self.bin_fill).min(self.rate - self.second_fill) as usize;
            let (chunk, after) = rest.split_at((span * self.channels).min(rest.len()));
            rest = after;
            let frames = (chunk.len() / self.channels) as u32;

            if let Some(meter) = loudness.as_deref_mut() {
                meter.push(chunk);
                self.bin_over |= meter.last_true_peak() > 1.0;
            }
            for frame in chunk.chunks_exact(self.channels) {
                self.measure(frame);
            }
            self.frames += u64::from(frames);
            self.bin_fill += frames;
            self.second_fill += frames;
            if self.bin_fill == self.bin_frames {
                self.close_bin();
            }
            if self.second_fill == self.rate {
                self.close_second(loudness.as_deref());
            }
        }
    }

    /// Closes the partial bin and second the stream ended in, and measures
    /// the silence at either end.
    pub fn finish(&mut self, loudness: Option<&Loudness>) {
        if self.bin_fill > 0 {
            self.close_bin();
        }
        if self.second_fill > 0 {
            self.close_second(loudness);
        }
        let ms = |frames: u64| (frames as f64 * 1000.0 / f64::from(self.rate)) as f32;
        let duration = ms(self.frames);
        let bin_end = |bin: u32| ms(u64::from(bin) * u64::from(self.bin_frames)).min(duration);
        self.silence = match (self.first_sound, self.last_sound) {
            (Some(first), Some(last)) => [bin_end(first), duration - bin_end(last + 1)],
            _ => [duration, duration],
        }
        .map(f32::round);
    }

    /// Short-term LUFS per second, one decimal, `-inf` where gated.
    pub fn loudness_curve(&self) -> &[f32] {
        &self.loudness_curve
    }

    /// L/R correlation per second, −1..1, two decimals.
    pub fn correlation_curve(&self) -> &[f32] {
        &self.correlation_curve
    }

    /// `[binIndex, samples, over]` for every 50 ms bin with a clip or a true
    /// peak over 0 dBTP, where `samples` counts the frames in runs of at
    /// least three full-scale frames and `over` is 0 or 1.
    pub fn clipping(&self) -> &[f32] {
        &self.clipping
    }

    /// Leading and trailing milliseconds below −60 dBFS; both are the whole
    /// duration for a stream that is silent throughout.
    pub fn silence(&self) -> &[f32; 2] {
        &self.silence
    }

    fn measure(&mut self, frame: &[f32]) {
        if self.measures.clipping {
            if frame.iter().any(|s| s.abs() >= CLIP_LEVEL) {
                self.run += 1;
                self.bin_clipped += match self.run {
                    CLIP_RUN => CLIP_RUN,
                    run if run > CLIP_RUN => 1,
                    _ => 0,
                };
            } else {
                self.run = 0;
            }
        }
        if self.measures.silence {
            self.bin_square += frame.iter().map(|&s| f64::from(s * s)).sum::<f64>();
        }
        if self.measures.curves {
            let (l, r) = (
                f64::from(frame[0]),
                f64::from(frame[1.min(frame.len() - 1)]),
            );
            let c = &mut self.correlation;
            c.l += l;
            c.r += r;
            c.ll += l * l;
            c.rr += r * r;
            c.lr += l * r;
            c.n += 1.0;
        }
    }

    fn close_bin(&mut self) {
        if self.measures.clipping && (self.bin_clipped > 0 || self.bin_over) {
            self.clipping.extend([
                self.bin_index as f32,
                self.bin_clipped as f32,
                f32::from(u8::from(self.bin_over)),
            ]);
        }
        let samples = f64::from(self.bin_fill) * self.channels as f64;
        if self.measures.silence && self.bin_square / samples >= SILENT_MEAN_SQUARE {
            self.first_sound.get_or_insert(self.bin_index);
            self.last_sound = Some(self.bin_index);
        }
        self.bin_index += 1;
        self.bin_fill = 0;
        self.bin_square = 0.0;
        self.bin_clipped = 0;
        self.bin_over = false;
    }

    fn close_second(&mut self, loudness: Option<&Loudness>) {
        if self.measures.curves {
            let lufs = loudness.map_or(f64::NEG_INFINITY, Loudness::short_term);
            self.loudness_curve
                .push(((lufs * 10.0).round() / 10.0) as f32);
            self.correlation_curve
                .push(std::mem::take(&mut self.correlation).value());
        }
        self.second_fill = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::offline::test_signals::{RATE, sine};

    const ALL: Measures = Measures {
        curves: true,
        clipping: true,
        silence: true,
    };

    fn run(interleaved: &[f32], channels: u32) -> Timeline {
        let mut loudness = Loudness::new(channels, RATE).unwrap();
        let mut timeline = Timeline::new(RATE, channels, ALL);
        for chunk in interleaved.chunks(3000 * channels as usize) {
            timeline.push(chunk, Some(&mut loudness));
        }
        timeline.finish(Some(&loudness));
        timeline
    }

    fn stereo(l: &[f32], r: &[f32]) -> Vec<f32> {
        l.iter().zip(r).flat_map(|(&a, &b)| [a, b]).collect()
    }

    #[test]
    fn a_half_amplitude_sine_reads_minus_six_lufs_from_the_first_second() {
        let tone = sine(1000.0, 0.5, 4.5);
        let timeline = run(&stereo(&tone, &tone), 2);
        let curve = timeline.loudness_curve();
        assert_eq!(curve.len(), 5);
        for &lufs in curve {
            assert!((lufs + 6.0).abs() <= 0.3, "{curve:?}");
        }
    }

    #[test]
    fn correlation_reads_one_for_mono_and_minus_one_for_inverted_channels() {
        let tone = sine(440.0, 0.5, 2.0);
        let inverted: Vec<f32> = tone.iter().map(|s| -s).collect();
        assert_eq!(run(&tone, 1).correlation_curve(), [1.0, 1.0]);
        assert_eq!(
            run(&stereo(&tone, &inverted), 2).correlation_curve(),
            [-1.0, -1.0]
        );
    }

    #[test]
    fn a_run_of_full_scale_samples_marks_its_bin_and_a_short_one_does_not() {
        let mut signal = vec![0.1f32; RATE as usize];
        // Five full-scale frames in bin 4, two in bin 10.
        for i in 0..5 {
            signal[2400 * 4 + 100 + i] = 1.0;
        }
        signal[2400 * 10 + 7] = -1.0;
        signal[2400 * 10 + 8] = -1.0;
        let timeline = run(&signal, 1);
        let clipping = timeline.clipping();
        assert_eq!(&clipping[..3], &[4.0, 5.0, 1.0]);
        assert!(
            clipping
                .chunks(3)
                .all(|bin| bin[0] != 10.0 || bin[1] == 0.0)
        );
    }

    #[test]
    fn silence_is_measured_at_both_ends() {
        let mut signal = vec![0.0f32; RATE as usize * 3];
        signal[RATE as usize / 2..RATE as usize * 2].copy_from_slice(&sine(440.0, 0.5, 1.5));
        let timeline = run(&signal, 1);
        assert_eq!(timeline.silence(), &[500.0, 1000.0]);
        assert_eq!(run(&vec![0.0; 4800], 1).silence(), &[100.0, 100.0]);
    }
}
