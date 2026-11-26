//! The spectrogram tile (E5): 128 mel bands, one column per 100 ms, dB
//! relative to full scale clamped to [−90, 0] and quantised to a `u8`.

use crate::util::mel::MelBank;

pub const SPECTROGRAM_BANDS: usize = 128;
const FLOOR_DB: f64 = -90.0;

pub struct Spectrogram {
    mel: MelBank,
    bands: [f32; SPECTROGRAM_BANDS],
    sum: [f64; SPECTROGRAM_BANDS],
    hops: u32,
    column: u64,
    bytes: Vec<u8>,
}

impl Spectrogram {
    /// Bands from 20 Hz to 20 kHz (or Nyquist) over the front end's transform.
    pub fn new(rate: u32, fft_size: usize) -> Self {
        Self {
            mel: MelBank::new(rate, fft_size, SPECTROGRAM_BANDS, 20.0, 20_000.0),
            bands: [0.0; SPECTROGRAM_BANDS],
            sum: [0.0; SPECTROGRAM_BANDS],
            hops: 0,
            column: 0,
            bytes: Vec::new(),
        }
    }

    /// Adds one hop's power spectrum, normalised so a full-scale sine's bin
    /// reads 1, to the 100 ms column `column` its centre falls in.
    pub fn push(&mut self, power: &[f32], column: u64) {
        if column != self.column {
            self.close();
            self.column = column;
        }
        self.mel.apply(power, &mut self.bands);
        for (sum, &band) in self.sum.iter_mut().zip(&self.bands) {
            *sum += f64::from(band);
        }
        self.hops += 1;
    }

    pub fn finish(&mut self) {
        self.close();
    }

    /// Column-major: `SPECTROGRAM_BANDS` bytes per column, lowest band first;
    /// 0 is −90 dB and below, 255 is 0 dB and above.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    fn close(&mut self) {
        if self.hops == 0 {
            return;
        }
        for sum in &mut self.sum {
            let mean = *sum / f64::from(self.hops);
            let db = (10.0 * mean.max(1e-12).log10()).clamp(FLOOR_DB, 0.0);
            self.bytes
                .push(((db - FLOOR_DB) / -FLOOR_DB * 255.0).round() as u8);
            *sum = 0.0;
        }
        self.hops = 0;
    }
}
