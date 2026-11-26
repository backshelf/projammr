//! Tempo and beat grid (E2), after D. P. W. Ellis, "Beat tracking by dynamic
//! programming", J. New Music Research 36(1), 2007: the onset envelope's
//! autocorrelation over 60–200 BPM weighted by a log-Gaussian tempo prior
//! centred on 120 BPM, then the beat phase by dynamic programming. The
//! confidence asks whether the envelope repeats at the chosen period's
//! multiples too, which a pulse does and a chance peak in noise does not.

use std::f32::consts::TAU;

/// The fastest and slowest beat periods considered, in seconds.
const MIN_PERIOD_S: f32 = 0.30;
const MAX_PERIOD_S: f32 = 1.00;
/// A half or double period whose autocorrelation reaches this share of the
/// best one is an octave the prior chooses between.
const OCTAVE_SHARE: f32 = 0.85;
/// Ellis's tightness: how strongly a beat is held to the period.
const TIGHTNESS: f32 = 100.0;
/// The span of the moving average taken off the onset envelope before the
/// confidence reads it, in seconds: twice the slowest period, so the pulse
/// passes through and a swell in onset density between passages does not.
const DETREND_S: f32 = 2.0;
/// How many multiples of the period the confidence reads.
const HARMONICS: usize = 4;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Tempo {
    /// Beats per minute, one decimal.
    pub bpm: f32,
    /// The first beat of the grid, `0 ≤ offset < 60000 / bpm`.
    pub beat_offset_ms: f32,
    /// How strongly the onset envelope repeats at the period and its
    /// multiples, 0..1: near 1 for a steady pulse, near 0 for noise.
    pub confidence: f32,
}

/// The log-Gaussian prior, one octave wide, centred on 120 BPM.
fn prior(bpm: f32) -> f32 {
    (-0.5 * (bpm / 120.0).log2().powi(2)).exp()
}

/// The tempo and beat grid of `onset` (one strength per hop of `hop_s`
/// seconds), or `None` when the envelope is shorter than two slowest beats
/// or carries no periodicity at all.
pub fn estimate(onset: &[f32], hop_s: f32) -> Option<Tempo> {
    let min_lag = (MIN_PERIOD_S / hop_s).round() as usize;
    let max_lag = (MAX_PERIOD_S / hop_s).round() as usize;
    if min_lag < 2 || onset.len() < 2 * max_lag + 2 {
        return None;
    }

    let mean = onset.iter().sum::<f32>() / onset.len() as f32;
    let centred: Vec<f32> = onset.iter().map(|v| v - mean).collect();
    let autocorrelation = |lag: usize| {
        centred
            .iter()
            .zip(&centred[lag..])
            .map(|(a, b)| a * b)
            .sum::<f32>()
            / (centred.len() - lag) as f32
    };
    // One extra lag each side, for the interpolation below.
    let ac: Vec<f32> = (min_lag - 1..=max_lag + 1).map(autocorrelation).collect();
    let ac_at = |lag: usize| ac[lag + 1 - min_lag];
    let bpm_at = |lag: f32| 60.0 / (lag * hop_s);

    let score = |lag: usize| ac_at(lag).max(0.0) * prior(bpm_at(lag as f32));
    let mass: f32 = (min_lag..=max_lag).map(score).sum();
    if mass <= 0.0 {
        return None;
    }
    let best = (min_lag..=max_lag)
        .max_by(|&a, &b| score(a).total_cmp(&score(b)))
        .unwrap_or(min_lag);

    // Octave tie-break: a half or double period nearly as periodic as the
    // winner goes to whichever the prior favours.
    let local_peak = |centre: usize| {
        (centre.saturating_sub(2).max(min_lag)..=(centre + 2).min(max_lag))
            .max_by(|&a, &b| ac_at(a).total_cmp(&ac_at(b)))
    };
    let lag = [best / 2, best * 2]
        .into_iter()
        .filter(|&octave| (min_lag..=max_lag).contains(&octave))
        .filter_map(local_peak)
        .filter(|&octave| ac_at(octave) >= OCTAVE_SHARE * ac_at(best))
        .chain([best])
        .max_by(|&a, &b| prior(bpm_at(a as f32)).total_cmp(&prior(bpm_at(b as f32))))
        .unwrap_or(best);

    // Parabolic interpolation of the autocorrelation peak.
    let (left, centre, right) = (ac_at(lag - 1), ac_at(lag), ac_at(lag + 1));
    let curvature = left - 2.0 * centre + right;
    let shift = if curvature < 0.0 {
        (0.5 * (left - right) / curvature).clamp(-0.5, 0.5)
    } else {
        0.0
    };
    let period = lag as f32 + shift;

    Some(Tempo {
        bpm: (bpm_at(period) * 10.0).round() / 10.0,
        beat_offset_ms: beat_phase(onset, period) * hop_s * 1000.0,
        confidence: coherence(onset, period, hop_s),
    })
}

/// How strongly `onset` repeats at `period` hops, 0..1: the mean of its
/// autocorrelation coefficient at each of the first `HARMONICS` multiples of
/// the period that fit in half the envelope, each read at the best of the
/// nearest lag and its neighbours. The envelope is first taken off its moving
/// average over `DETREND_S`, so a swell in onset density does not read as
/// periodicity at every lag. A pulse repeats at every multiple; noise's best
/// lag is a chance peak, and its multiples read near 0.
fn coherence(onset: &[f32], period: f32, hop_s: f32) -> f32 {
    let n = onset.len();
    let reach = (DETREND_S / hop_s / 2.0).round() as usize;
    let mut prefix = vec![0.0f64; n + 1];
    for (t, &value) in onset.iter().enumerate() {
        prefix[t + 1] = prefix[t] + f64::from(value);
    }
    let detrended: Vec<f32> = (0..n)
        .map(|t| {
            let (from, to) = (t.saturating_sub(reach), (t + reach + 1).min(n));
            onset[t] - ((prefix[to] - prefix[from]) / (to - from) as f64) as f32
        })
        .collect();
    let mean = detrended.iter().sum::<f32>() / n as f32;
    let centred: Vec<f32> = detrended.iter().map(|v| v - mean).collect();
    let variance = centred.iter().map(|v| v * v).sum::<f32>() / n as f32;
    if variance <= 0.0 {
        return 0.0;
    }
    let coefficient = |lag: usize| {
        centred
            .iter()
            .zip(&centred[lag..])
            .map(|(a, b)| a * b)
            .sum::<f32>()
            / (n - lag) as f32
            / variance
    };

    let peaks: Vec<f32> = (1..=HARMONICS)
        .map(|multiple| multiple as f32 * period)
        .filter(|&lag| lag <= n as f32 / 2.0)
        .map(|lag| {
            let nearest = lag.round() as usize;
            (nearest - 1..=nearest + 1)
                .map(coefficient)
                .fold(f32::MIN, f32::max)
        })
        .collect();
    if peaks.is_empty() {
        return 0.0;
    }
    (peaks.iter().sum::<f32>() / peaks.len() as f32).clamp(0.0, 1.0)
}

/// The grid's phase in hops, `0 ≤ phase < period`: the circular mean of the
/// beats Ellis's dynamic programme places, each beat's cumulative score the
/// best predecessor between half and twice a period back, penalised by the
/// squared log of how far that gap is from the period.
fn beat_phase(onset: &[f32], period: f32) -> f32 {
    let mean = onset.iter().sum::<f32>() / onset.len() as f32;
    let deviation = (onset.iter().map(|v| (v - mean).powi(2)).sum::<f32>() / onset.len() as f32)
        .sqrt()
        .max(1e-9);
    let local: Vec<f32> = onset.iter().map(|v| v / deviation).collect();

    let mut cumulative = local.clone();
    let mut previous = vec![usize::MAX; local.len()];
    let (nearest, farthest) = (
        (period / 2.0).round() as usize,
        (period * 2.0).round() as usize,
    );
    for t in nearest..local.len() {
        let best = (nearest..=farthest.min(t))
            .map(|gap| {
                let penalty = TIGHTNESS * (gap as f32 / period).ln().powi(2);
                (t - gap, cumulative[t - gap] - penalty)
            })
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((from, value)) = best {
            cumulative[t] += value;
            previous[t] = from;
        }
    }

    // The last beat is the best cumulative score in the final period.
    let tail = local.len().saturating_sub(period.ceil() as usize);
    let mut beat = (tail..local.len())
        .max_by(|&a, &b| cumulative[a].total_cmp(&cumulative[b]))
        .unwrap_or(0);
    let (mut x, mut y) = (0.0f32, 0.0f32);
    loop {
        let angle = TAU * beat as f32 / period;
        x += angle.cos();
        y += angle.sin();
        match previous[beat] {
            usize::MAX => break,
            from => beat = from,
        }
    }
    y.atan2(x).rem_euclid(TAU) / TAU * period
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::offline::onsets::FrontEnd;
    use crate::analysis::offline::test_signals::{RATE, click_train, noise};

    /// The seeds a noisy signal is drawn from; a band holds only if it holds
    /// at every one.
    const SEEDS: [u32; 5] = [1, 2, 3, 7, 42];
    /// Every unpulsed signal reads under `NOISE_CEILING` and every pulse over
    /// `PULSE_FLOOR`, so the client's `LOW_CONFIDENCE_THRESHOLD` (0.1) falls
    /// in the gap between the two.
    const NOISE_CEILING: f32 = 0.08;
    const PULSE_FLOOR: f32 = 0.2;

    fn tempo_of(signal: &[f32]) -> Option<Tempo> {
        let mut front = FrontEnd::new(RATE, false);
        front.push(signal);
        front.finish();
        estimate(front.onset(), 1.0 / front.hop_rate())
    }

    /// The confidence of `signal` at each of `SEEDS`, 0 where it has no tempo.
    fn confidences(signal: impl Fn(u32) -> Vec<f32>) -> Vec<f32> {
        SEEDS
            .iter()
            .map(|&seed| tempo_of(&signal(seed)).map_or(0.0, |tempo| tempo.confidence))
            .collect()
    }

    /// `count` uniform draws in -1..1 from `seed`.
    fn draws(count: usize, seed: u32) -> Vec<f32> {
        noise(count as f32 / RATE as f32, 1.0, seed)
    }

    /// A 30 ms noise hit on every beat at `bpm`, each up to `jitter_s` early
    /// or late, over a noise floor a fifth of the hits' level.
    fn groove(bpm: f32, seconds: f32, jitter_s: f32, seed: u32) -> Vec<f32> {
        let mut signal = noise(seconds, 0.2, seed);
        let hit: Vec<f32> = noise(0.03, 1.0, seed + 1)
            .iter()
            .enumerate()
            .map(|(i, v)| v * (-60.0 * i as f32 / RATE as f32).exp())
            .collect();
        let beat_s = 60.0 / bpm;
        let beats = (seconds / beat_s) as usize;
        for (beat, jitter) in draws(beats, seed + 2).iter().enumerate() {
            let at = ((0.2 + beat as f32 * beat_s + jitter * jitter_s) * RATE as f32) as usize;
            for (sample, v) in signal.iter_mut().skip(at).zip(&hit) {
                *sample += v;
            }
        }
        signal
    }

    /// Noise whose level glides to a new target every 2–6 s: onset density
    /// that changes from passage to passage with no pulse in it.
    fn swells(seconds: f32, seed: u32) -> Vec<f32> {
        let mut signal = noise(seconds, 1.0, seed);
        let segments = (seconds / 2.0).ceil() as usize;
        let (mut at, mut from) = (0, 0.1);
        for pair in draws(2 * segments, seed + 1).chunks(2) {
            let len = ((4.0 + 2.0 * pair[0]) * RATE as f32) as usize;
            let to = 0.51 + 0.49 * pair[1];
            for (i, sample) in signal.iter_mut().skip(at).take(len).enumerate() {
                *sample *= from + (to - from) * i as f32 / len as f32;
            }
            (at, from) = (at + len, to);
        }
        signal
    }

    #[test]
    fn a_click_train_at_120_bpm_reads_120() {
        let tempo = tempo_of(&click_train(120.0, 0.25, 30.0)).unwrap();
        assert!((tempo.bpm - 120.0).abs() <= 0.5, "{tempo:?}");
        assert!(tempo.confidence > 0.9, "{tempo:?}");
        assert!((tempo.beat_offset_ms - 250.0).abs() <= 30.0, "{tempo:?}");
    }

    #[test]
    fn a_click_train_at_90_bpm_reads_90() {
        let tempo = tempo_of(&click_train(90.0, 0.1, 30.0)).unwrap();
        assert!((tempo.bpm - 90.0).abs() <= 0.5, "{tempo:?}");
        assert!(tempo.confidence > 0.9, "{tempo:?}");
        assert!((tempo.beat_offset_ms - 100.0).abs() <= 30.0, "{tempo:?}");
    }

    #[test]
    fn white_noise_reads_under_the_noise_ceiling_at_every_seed() {
        let band = confidences(|seed| noise(8.0, 0.5, seed));
        assert!(band.iter().all(|&c| c < NOISE_CEILING), "{band:?}");
    }

    #[test]
    fn swells_in_loudness_read_under_the_noise_ceiling_at_every_seed() {
        let band = confidences(|seed| swells(10.0, seed));
        assert!(band.iter().all(|&c| c < NOISE_CEILING), "{band:?}");
    }

    #[test]
    fn a_loose_groove_over_noise_reads_over_the_pulse_floor_at_every_seed() {
        let band = confidences(|seed| groove(150.0, 8.0, 0.02, seed));
        assert!(band.iter().all(|&c| c > PULSE_FLOOR), "{band:?}");
    }

    #[test]
    fn silence_has_no_tempo() {
        assert_eq!(tempo_of(&vec![0.0; RATE as usize * 10]), None);
    }
}
