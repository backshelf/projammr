//! The chain the Lab plays through: every block, in [`BlockId`] order, on one
//! source.
//!
//! The chain pulls. [`Chain::process`] is handed the source from the current
//! read position and the output to fill; it reads as many source frames as
//! the speed needs and reports how many it read. Output lags the source by
//! [`Chain::latency`] output frames, silent at first, and a source that runs
//! out reads as silence, so the tail plays out.
//!
//! Work happens in quanta of at most [`QUANTUM`] frames. A parameter change
//! lands at the start of the next quantum, and its coefficients (or, for a
//! bypass, the dry and processed signals) cross-fade across that quantum.
//! Every buffer is allocated in [`Chain::new`]; processing never allocates.

use super::bands::BandSolo;
use super::crossfeed::Crossfeed;
use super::device::DeviceCurve;
use super::dynamics::Compressor;
use super::eq::{CURVE_CENTRES_HZ, Eq};
use super::gain::Gain;
use super::params::{BlockId, MeterId, ParamId};
use super::pitch::TimePitch;
use super::reverb::Reverb;
use super::stereo::Stereo;
use super::{Block, CHANNELS};
use crate::error::DspError;

/// The largest number of frames processed with one set of parameters.
pub const QUANTUM: usize = 128;
pub const MIN_RATE: u32 = 8_000;
pub const MAX_RATE: u32 = 384_000;
pub const EQ_CURVE_BANDS: usize = CURVE_CENTRES_HZ.len();

const BLOCKS: usize = BlockId::ALL.len();

pub struct Chain {
    time: TimePitch,
    bands: BandSolo,
    eq: Eq,
    compressor: Compressor,
    reverb: Reverb,
    stereo: Stereo,
    crossfeed: Crossfeed,
    device: DeviceCurve,
    gain: Gain,
    bypassed: [bool; BLOCKS],
    /// How much of each block's output is heard: 0 bypassed, 1 on.
    mix: [f32; BLOCKS],
    dry: Vec<f32>,
}

impl Chain {
    pub fn new(rate: u32) -> Result<Self, DspError> {
        if !(MIN_RATE..=MAX_RATE).contains(&rate) {
            return Err(DspError::BadArgument);
        }
        let rate_hz = rate as f32;
        let bypassed: [bool; BLOCKS] =
            std::array::from_fn(|i| BlockId::ALL[i].bypassed_by_default());
        let mut chain = Self {
            time: TimePitch::new(),
            bands: BandSolo::new(rate_hz, QUANTUM),
            eq: Eq::with_defaults(rate_hz),
            compressor: Compressor::with_defaults(rate_hz),
            reverb: Reverb::with_defaults(rate_hz),
            stereo: Stereo::new(rate_hz),
            crossfeed: Crossfeed::new(rate_hz),
            device: DeviceCurve::new(rate_hz, QUANTUM),
            gain: Gain::new(),
            bypassed,
            mix: bypassed.map(|off| if off { 0.0 } else { 1.0 }),
            dry: vec![0.0; QUANTUM * CHANNELS],
        };
        chain.time.set_bypass(bypassed[BlockId::TimePitch as usize]);
        Ok(chain)
    }

    /// The in-place block `id` names; `None` for time and pitch, which is not
    /// in place.
    fn block(&mut self, id: BlockId) -> Option<&mut dyn Block> {
        Some(match id {
            BlockId::TimePitch => return None,
            BlockId::BandSolo => &mut self.bands,
            BlockId::Eq => &mut self.eq,
            BlockId::Compressor => &mut self.compressor,
            BlockId::Reverb => &mut self.reverb,
            BlockId::Stereo => &mut self.stereo,
            BlockId::Crossfeed => &mut self.crossfeed,
            BlockId::Device => &mut self.device,
            BlockId::Gain => &mut self.gain,
        })
    }

    pub fn set(&mut self, param: u32, value: f32) -> Result<(), DspError> {
        let param = ParamId::from_id(param).ok_or(DspError::BadArgument)?;
        let spec = param.spec();
        let value = spec.domain.accept(value).ok_or(DspError::BadArgument)?;
        match self.block(spec.block) {
            Some(block) => block.set(param, value),
            None => self.time.set(param, value),
        }
        Ok(())
    }

    pub fn set_bypass(&mut self, block: u32, bypassed: bool) -> Result<(), DspError> {
        let id = BlockId::from_id(block).ok_or(DspError::BadArgument)?;
        self.bypassed[id as usize] = bypassed;
        if id == BlockId::TimePitch {
            self.time.set_bypass(bypassed);
        }
        Ok(())
    }

    /// Replaces the EQ's bands with a 1/3-octave curve, or restores them.
    pub fn set_eq_curve(&mut self, gains: Option<&[f32]>) -> Result<(), DspError> {
        let curve = match gains {
            None => None,
            Some(gains) => Some(
                <&[f32; EQ_CURVE_BANDS]>::try_from(gains)
                    .ok()
                    .filter(|g| g.iter().all(|v| v.is_finite()))
                    .ok_or(DspError::BadArgument)?,
            ),
        };
        self.eq.set_curve(curve);
        Ok(())
    }

    /// Fills `out` (interleaved stereo) from `source` (interleaved stereo,
    /// from the read position on) and returns the source frames read.
    pub fn process(&mut self, source: &[f32], out: &mut [f32]) -> usize {
        let mut consumed = 0;
        let mut dry = std::mem::take(&mut self.dry);
        for quantum in out.chunks_mut(QUANTUM * CHANNELS) {
            self.time.pull(source, &mut consumed, quantum);
            for &id in &BlockId::ALL[1..] {
                self.run(id, quantum, &mut dry);
            }
        }
        self.dry = dry;
        consumed
    }

    fn run(&mut self, id: BlockId, samples: &mut [f32], dry: &mut [f32]) {
        let index = id as usize;
        let from = self.mix[index];
        let to = if self.bypassed[index] { 0.0 } else { 1.0 };
        if from == 0.0 && to == 0.0 {
            return;
        }
        let Some(block) = self.block(id) else {
            return;
        };
        if from == 1.0 && to == 1.0 {
            block.process(samples);
            return;
        }

        let dry = &mut dry[..samples.len()];
        dry.copy_from_slice(samples);
        block.process(samples);
        let frames = samples.len() / CHANNELS;
        for (i, (wet, dry)) in samples
            .chunks_exact_mut(CHANNELS)
            .zip(dry.chunks_exact(CHANNELS))
            .enumerate()
        {
            let mix = from + (to - from) * (i + 1) as f32 / frames as f32;
            for (w, d) in wet.iter_mut().zip(dry) {
                *w = d + (*w - d) * mix;
            }
        }
        if to == 0.0 {
            block.reset();
        }
        self.mix[index] = to;
    }

    /// Flushes every buffer and signal state, keeping the parameters: what a
    /// seek needs.
    pub fn reset(&mut self) {
        self.time.reset();
        for &id in &BlockId::ALL[1..] {
            if let Some(block) = self.block(id) {
                block.reset();
            }
        }
    }

    /// Output frames between a source frame being read and being heard.
    pub fn latency(&self) -> usize {
        self.time.latency()
    }

    pub fn meter(&mut self, meter: u32) -> Option<f32> {
        let meter = MeterId::from_id(meter)?;
        BlockId::ALL[1..]
            .iter()
            .find_map(|&id| self.block(id).and_then(|block| block.meter(meter)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::play::stereo::StereoMode;
    use crate::play::stretch::tests::sine;

    const RATE: u32 = 48_000;

    fn run(chain: &mut Chain, source: &[f32], frames: usize) -> (Vec<f32>, usize) {
        let mut out = vec![0.0; frames * CHANNELS];
        let mut consumed = 0;
        for quantum in out.chunks_mut(QUANTUM * CHANNELS) {
            consumed += chain.process(&source[(consumed * CHANNELS).min(source.len())..], quantum);
        }
        (out, consumed)
    }

    #[test]
    fn a_new_chain_passes_the_source_through_after_its_latency() {
        let mut chain = Chain::new(RATE).unwrap();
        let source = sine(440.0, 12_000);
        let (out, consumed) = run(&mut chain, &source, 12_000);
        let latency = chain.latency();
        assert_eq!(
            &out[latency * CHANNELS..],
            &source[..(12_000 - latency) * CHANNELS]
        );
        assert!(consumed >= 12_000 - latency);
    }

    #[test]
    fn rates_outside_the_supported_range_are_refused() {
        assert_eq!(Chain::new(4_000).err(), Some(DspError::BadArgument));
        assert_eq!(Chain::new(1_000_000).err(), Some(DspError::BadArgument));
    }

    #[test]
    fn unknown_parameters_and_values_outside_a_domain_are_refused() {
        let mut chain = Chain::new(RATE).unwrap();
        assert_eq!(
            chain.set(ParamId::ALL.len() as u32, 0.0),
            Err(DspError::BadArgument)
        );
        assert_eq!(
            chain.set(ParamId::TimeSpeed as u32, 3.0),
            Err(DspError::BadArgument)
        );
        assert_eq!(
            chain.set(ParamId::GainDim as u32, f32::NAN),
            Err(DspError::BadArgument)
        );
        assert_eq!(chain.set(ParamId::TimeSpeed as u32, 2.0), Ok(()));
        assert_eq!(
            chain.set_bypass(BlockId::ALL.len() as u32, true),
            Err(DspError::BadArgument)
        );
        assert_eq!(
            chain.set_eq_curve(Some(&[0.0; 30])),
            Err(DspError::BadArgument)
        );
        assert_eq!(chain.set_eq_curve(Some(&[0.0; 31])), Ok(()));
        assert_eq!(chain.set_eq_curve(None), Ok(()));
    }

    #[test]
    fn speed_2_reads_the_source_twice_as_fast() {
        let mut chain = Chain::new(RATE).unwrap();
        chain.set(ParamId::TimeSpeed as u32, 2.0).unwrap();
        let source = sine(440.0, 10 * RATE as usize);
        let (_, consumed) = run(&mut chain, &source, 2 * RATE as usize);
        let expected = 2 * (2 * RATE as usize);
        assert!(
            consumed.abs_diff(expected) <= 2 * crate::play::stretch::FRAME,
            "{consumed}"
        );
    }

    #[test]
    fn a_bypass_cross_fades_between_the_dry_and_processed_signals_across_one_quantum() {
        const PRIME: usize = 4096;
        let mut chain = Chain::new(RATE).unwrap();
        // Identical channels at 0.5: the stereo block's side solo turns them
        // into silence, so dry is 0.5 and processed is 0.
        let source = vec![0.5f32; 4 * RATE as usize * CHANNELS];
        chain
            .set(ParamId::StereoMode as u32, StereoMode::Side as usize as f32)
            .unwrap();
        let (primed, mut read) = run(&mut chain, &source, PRIME);
        assert!(
            primed[primed.len() - CHANNELS..]
                .iter()
                .all(|v| v.abs() < 1e-6)
        );

        let mut assert_fade = |chain: &mut Chain, from: f32, to: f32| {
            let (out, consumed) = run(chain, &source[read * CHANNELS..], 2 * QUANTUM);
            read += consumed;
            for (i, frame) in out.chunks_exact(CHANNELS).enumerate() {
                let mix = ((i + 1) as f32 / QUANTUM as f32).min(1.0);
                let expected = from + (to - from) * mix;
                for sample in frame {
                    assert!((sample - expected).abs() < 1e-4, "frame {i}: {sample}");
                }
            }
        };
        chain.set_bypass(BlockId::Stereo as u32, true).unwrap();
        assert_fade(&mut chain, 0.0, 0.5);
        chain.set_bypass(BlockId::Stereo as u32, false).unwrap();
        assert_fade(&mut chain, 0.5, 0.0);
    }

    #[test]
    fn meters_read_the_compressor_and_the_stereo_block() {
        let mut chain = Chain::new(RATE).unwrap();
        chain.set_bypass(BlockId::Compressor as u32, false).unwrap();
        chain.set(ParamId::CompThresholdDb as u32, -40.0).unwrap();
        let source = sine(440.0, RATE as usize);
        run(&mut chain, &source, RATE as usize / 2);
        assert!(chain.meter(MeterId::GainReductionDb as u32).unwrap() > 10.0);
        let correlation = chain.meter(MeterId::Correlation as u32).unwrap();
        assert!((correlation - 1.0).abs() < 1e-3, "{correlation}");
        assert_eq!(chain.meter(MeterId::ALL.len() as u32), None);
    }

    #[test]
    fn reset_silences_the_output_until_new_source_arrives() {
        let mut chain = Chain::new(RATE).unwrap();
        chain.set_bypass(BlockId::Reverb as u32, false).unwrap();
        let source = sine(440.0, RATE as usize);
        run(&mut chain, &source, RATE as usize / 2);
        chain.reset();
        let (out, _) = run(&mut chain, &[], 1024);
        assert!(out.iter().all(|v| v.abs() < 1e-9));
    }
}
