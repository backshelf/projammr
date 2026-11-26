//! Forward and inverse real FFTs of a power-of-two length, planned once per
//! size for the whole module and shared by every object that transforms at
//! that size.
//!
//! An iterative radix-2 transform rather than `rustfft`: every size this crate
//! transforms at is a power of two, and `rustfft`'s planner compiles an
//! algorithm for every length (prime-size butterflies, Bluestein's method)
//! into the module, which was the larger part of its size. The conventions
//! match `realfft`'s: the forward transform returns `len / 2 + 1` bins,
//! unnormalised, and the inverse returns `len` times the signal.

use std::cell::RefCell;
use std::sync::Arc;

/// A complex number, as the transforms read and write their bins.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Complex {
    pub re: f32,
    pub im: f32,
}

impl Complex {
    pub const fn new(re: f32, im: f32) -> Self {
        Self { re, im }
    }

    pub fn from_polar(magnitude: f32, phase: f32) -> Self {
        Self::new(magnitude * phase.cos(), magnitude * phase.sin())
    }

    pub fn norm(self) -> f32 {
        self.re.hypot(self.im)
    }

    /// Magnitude and phase in (−π, π].
    pub fn to_polar(self) -> (f32, f32) {
        (self.norm(), self.im.atan2(self.re))
    }
}

/// A buffer whose length does not match the plan it was handed to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LengthMismatch;

/// The tables one size's transforms share.
struct Tables {
    len: usize,
    /// The index each position swaps with in the bit-reversal permutation.
    reversed: Vec<u32>,
    /// `cos(2πk / len)` and `sin(2πk / len)` for `k < len / 2`.
    cos: Vec<f32>,
    sin: Vec<f32>,
}

impl Tables {
    fn new(len: usize) -> Self {
        assert!(
            len >= 2 && len.is_power_of_two(),
            "an FFT length is a power of two of at least 2, not {len}"
        );
        let bits = len.trailing_zeros();
        let reversed = (0..len as u32)
            .map(|i| i.reverse_bits() >> (u32::BITS - bits))
            .collect();
        let angle = |k: usize| std::f64::consts::TAU * k as f64 / len as f64;
        Self {
            len,
            reversed,
            cos: (0..len / 2).map(|k| angle(k).cos() as f32).collect(),
            sin: (0..len / 2).map(|k| angle(k).sin() as f32).collect(),
        }
    }

    /// Transforms `buffer` in place: `Σ x[n]·e^(sign·2πikn/len)`, unnormalised.
    fn transform(&self, buffer: &mut [Complex], sign: f32) {
        for (i, &j) in self.reversed.iter().enumerate() {
            let j = j as usize;
            if i < j {
                buffer.swap(i, j);
            }
        }
        let mut size = 2;
        while size <= self.len {
            let half = size / 2;
            let stride = self.len / size;
            for block in buffer.chunks_exact_mut(size) {
                let (low, high) = block.split_at_mut(half);
                for (k, (a, b)) in low.iter_mut().zip(high.iter_mut()).enumerate() {
                    let (cos, sin) = (self.cos[k * stride], sign * self.sin[k * stride]);
                    let t = Complex::new(cos * b.re - sin * b.im, cos * b.im + sin * b.re);
                    *b = Complex::new(a.re - t.re, a.im - t.im);
                    *a = Complex::new(a.re + t.re, a.im + t.im);
                }
            }
            size *= 2;
        }
    }
}

/// The forward (real to complex) transform of one length.
pub struct ForwardFft(Arc<Tables>);

impl ForwardFft {
    /// Complex bins of `scratch` the transform works in.
    pub fn get_scratch_len(&self) -> usize {
        self.0.len
    }

    pub fn make_output_vec(&self) -> Vec<Complex> {
        vec![Complex::default(); self.0.len / 2 + 1]
    }

    /// Transforms `input` (`len` samples) into `output` (`len / 2 + 1` bins),
    /// working in `scratch`; allocates nothing.
    pub fn process_with_scratch(
        &self,
        input: &mut [f32],
        output: &mut [Complex],
        scratch: &mut [Complex],
    ) -> Result<(), LengthMismatch> {
        let len = self.0.len;
        if input.len() != len || output.len() != len / 2 + 1 || scratch.len() < len {
            return Err(LengthMismatch);
        }
        let work = &mut scratch[..len];
        for (bin, &sample) in work.iter_mut().zip(input.iter()) {
            *bin = Complex::new(sample, 0.0);
        }
        self.0.transform(work, -1.0);
        output.copy_from_slice(&work[..=len / 2]);
        Ok(())
    }

    pub fn process(&self, input: &mut [f32], output: &mut [Complex]) -> Result<(), LengthMismatch> {
        let mut scratch = vec![Complex::default(); self.get_scratch_len()];
        self.process_with_scratch(input, output, &mut scratch)
    }
}

/// The inverse (complex to real) transform of one length.
pub struct InverseFft(Arc<Tables>);

impl InverseFft {
    /// Complex bins of `scratch` the transform works in.
    pub fn get_scratch_len(&self) -> usize {
        self.0.len
    }

    pub fn make_output_vec(&self) -> Vec<f32> {
        vec![0.0; self.0.len]
    }

    /// Transforms `input` (`len / 2 + 1` bins, the spectrum of a real signal)
    /// into `output` (`len` samples, `len` times that signal), working in
    /// `scratch`; allocates nothing.
    pub fn process_with_scratch(
        &self,
        input: &mut [Complex],
        output: &mut [f32],
        scratch: &mut [Complex],
    ) -> Result<(), LengthMismatch> {
        let len = self.0.len;
        let half = len / 2;
        if input.len() != half + 1 || output.len() != len || scratch.len() < len {
            return Err(LengthMismatch);
        }
        let work = &mut scratch[..len];
        work[..=half].copy_from_slice(input);
        // A real signal's negative frequencies are the conjugates of its positive ones.
        for k in 1..half {
            work[len - k] = Complex::new(input[k].re, -input[k].im);
        }
        self.0.transform(work, 1.0);
        for (sample, bin) in output.iter_mut().zip(work.iter()) {
            *sample = bin.re;
        }
        Ok(())
    }

    pub fn process(&self, input: &mut [Complex], output: &mut [f32]) -> Result<(), LengthMismatch> {
        let mut scratch = vec![Complex::default(); self.get_scratch_len()];
        self.process_with_scratch(input, output, &mut scratch)
    }
}

thread_local! {
    // A handful of sizes at most, so a list is the per-size cache.
    static PLANS: RefCell<Vec<(Arc<ForwardFft>, Arc<InverseFft>)>> = const { RefCell::new(Vec::new()) };
}

fn plans(len: usize) -> (Arc<ForwardFft>, Arc<InverseFft>) {
    PLANS.with_borrow_mut(|plans| {
        if let Some(found) = plans.iter().find(|(forward, _)| forward.0.len == len) {
            return found.clone();
        }
        let tables = Arc::new(Tables::new(len));
        let made = (
            Arc::new(ForwardFft(tables.clone())),
            Arc::new(InverseFft(tables)),
        );
        plans.push(made.clone());
        made
    })
}

/// The forward transform of `len` samples, a power of two. The output has
/// `len / 2 + 1` bins and is not normalised.
pub fn forward(len: usize) -> Arc<ForwardFft> {
    plans(len).0
}

/// The inverse transform of `len` samples, a power of two. Its output is
/// `len` times the signal a forward transform started from.
pub fn inverse(len: usize) -> Arc<InverseFft> {
    plans(len).1
}

/// Both directions at one size, for an object that analyses and resynthesises.
#[derive(Clone)]
pub struct FftPair {
    pub forward: Arc<ForwardFft>,
    pub inverse: Arc<InverseFft>,
}

impl FftPair {
    pub fn new(len: usize) -> Self {
        let (forward, inverse) = plans(len);
        Self { forward, inverse }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_size_shares_one_plan() {
        assert!(Arc::ptr_eq(&forward(256), &forward(256)));
        assert!(Arc::ptr_eq(&inverse(256), &inverse(256)));
        assert!(!Arc::ptr_eq(&forward(256), &forward(512)));
    }

    #[test]
    fn forward_then_inverse_restores_the_signal() {
        let len = 1024;
        let pair = FftPair::new(len);
        let signal: Vec<f32> = (0..len)
            .map(|i| ((i * 7919) % 97) as f32 / 97.0 - 0.5)
            .collect();

        let mut input = signal.clone();
        let mut spectrum = pair.forward.make_output_vec();
        pair.forward.process(&mut input, &mut spectrum).unwrap();
        let mut output = pair.inverse.make_output_vec();
        pair.inverse.process(&mut spectrum, &mut output).unwrap();

        for (restored, original) in output.iter().zip(&signal) {
            assert!((restored / len as f32 - original).abs() < 1e-5);
        }
    }

    #[test]
    fn a_sine_on_a_bin_centre_lands_in_that_bin() {
        let len = 512;
        let bin = 37;
        let plan = forward(len);
        let mut input: Vec<f32> = (0..len)
            .map(|i| (2.0 * std::f32::consts::PI * bin as f32 * i as f32 / len as f32).sin())
            .collect();
        let mut spectrum = plan.make_output_vec();
        plan.process(&mut input, &mut spectrum).unwrap();

        let loudest = (0..spectrum.len())
            .max_by(|&a, &b| spectrum[a].norm().total_cmp(&spectrum[b].norm()))
            .unwrap();
        assert_eq!(loudest, bin);
        // A unit sine's bin holds half the frame's length in magnitude.
        assert!((spectrum[bin].norm() - len as f32 / 2.0).abs() < 1e-2);
    }

    #[test]
    fn every_bin_matches_the_textbook_sum() {
        let len = 64;
        let signal: Vec<f32> = (0..len)
            .map(|i| ((i * 31) % 17) as f32 / 17.0 - 0.4)
            .collect();
        let mut input = signal.clone();
        let plan = forward(len);
        let mut spectrum = plan.make_output_vec();
        plan.process(&mut input, &mut spectrum).unwrap();

        for (k, bin) in spectrum.iter().enumerate() {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (n, &x) in signal.iter().enumerate() {
                let angle = -std::f64::consts::TAU * k as f64 * n as f64 / len as f64;
                re += f64::from(x) * angle.cos();
                im += f64::from(x) * angle.sin();
            }
            assert!((f64::from(bin.re) - re).abs() < 1e-4, "bin {k} re");
            assert!((f64::from(bin.im) - im).abs() < 1e-4, "bin {k} im");
        }
    }

    #[test]
    fn a_length_mismatch_is_an_error() {
        let plan = forward(16);
        let mut short = vec![0.0; 8];
        let mut spectrum = plan.make_output_vec();
        assert_eq!(plan.process(&mut short, &mut spectrum), Err(LengthMismatch));
    }
}
