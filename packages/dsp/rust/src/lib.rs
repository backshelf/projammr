//! The export surface of `dsp.wasm`. Every `#[unsafe(no_mangle)]` function in
//! the crate is here; the modules below are ordinary Rust with native tests.
//!
//! Every export follows the same rules, because the audio thread's global
//! scope has no `TextDecoder` and so no room for generated glue:
//!
//! - Arguments and results are numbers. Names are `snake_case`, prefixed by
//!   the object kind they act on, and `dsp_*` for the module itself.
//! - Objects live in one [`registry::Table`] per kind, behind non-zero `u32`
//!   handles. `*_new` returns 0 on failure and leaves the reason in
//!   `dsp_last_error()`; `*_free` and every other call that can fail return a
//!   [`DspError`] code, 0 on success. [`registry::Handles`] implements all three.
//! - Sample data is interleaved `f32`, frames × channels, in memory the host
//!   allocates with `dsp_alloc` and frees with `dsp_free`.
//! - A result is read through a `*_ptr` / `*_len` pair into storage the object
//!   owns, valid until the next call on that handle.
//! - Bad input returns an error code. A panic aborts, which the host sees as a
//!   trap, so a trap is always a bug.
//!
//! [`ABI_VERSION`] changes whenever an export's name, signature or meaning
//! does, and the loader refuses a module whose version it does not expect.

mod analysis;
pub mod error;
pub mod play;
pub mod registry;
pub mod util;

use std::alloc::Layout;
use std::cell::RefCell;

pub use error::DspError;
use registry::{Handles, Registry};

pub const ABI_VERSION: u32 = 1;

/// Alignment of every host allocation: enough for an `f64` or a SIMD vector.
const ALIGN: usize = 16;

#[unsafe(no_mangle)]
pub extern "C" fn dsp_abi_version() -> u32 {
    ABI_VERSION
}

/// The code the most recent failing `*_new` or `dsp_alloc` recorded.
#[unsafe(no_mangle)]
pub extern "C" fn dsp_last_error() -> i32 {
    DspError::last() as i32
}

/// Allocates `bytes` for the host to fill. Returns null and records
/// `BadArgument` for 0 bytes, or `OutOfMemory` when the size is impossible or
/// memory cannot grow.
#[unsafe(no_mangle)]
pub extern "C" fn dsp_alloc(bytes: usize) -> *mut u8 {
    let Some(layout) = host_layout(bytes) else {
        return std::ptr::null_mut();
    };
    // SAFETY: `host_layout` never returns a zero-sized layout.
    let ptr = unsafe { std::alloc::alloc(layout) };
    if ptr.is_null() {
        DspError::OutOfMemory.record();
    }
    ptr
}

/// Frees an allocation `dsp_alloc(bytes)` returned. A null pointer or 0 bytes
/// is ignored.
///
/// # Safety
///
/// A non-null `ptr` came from `dsp_alloc` called with the same `bytes`, and
/// has not been freed since.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dsp_free(ptr: *mut u8, bytes: usize) {
    if ptr.is_null() || bytes == 0 {
        return;
    }
    let Ok(layout) = Layout::from_size_align(bytes, ALIGN) else {
        return;
    };
    // SAFETY: the caller guarantees `dsp_alloc` returned `ptr` for `bytes`,
    // which allocated with this same layout.
    unsafe { std::alloc::dealloc(ptr, layout) }
}

thread_local! {
    static ANALYSES: RefCell<Registry<analysis::Session>> = const { RefCell::new(Registry::new()) };
}

/// Opens an `Analysis` session over one interleaved stream at `rate` Hz,
/// `channels` channels, running the analysers `flags` names: bit 0 peaks,
/// bit 1 loudness, bit 2 spectrum, bit 3 live readouts, then the offline
/// analyses `analysis_finish` computes — bit 4 features, 5 tempo, 6 key,
/// 7 sections, 8 spectrogram, 9 loudness and correlation curves, 10 clipping,
/// 11 silence, 12 pitch track. A higher bit fails the call. Returns 0 on
/// failure, with the reason in `dsp_last_error()`.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_new(rate: u32, channels: u32, flags: u32) -> u32 {
    ANALYSES.open(analysis::Session::new(rate, channels, flags))
}

/// Feeds `frames` interleaved frames (`frames * channels` `f32` samples,
/// read from `ptr`) to every analyser `handle`'s flags named.
///
/// # Safety
///
/// `ptr` names at least `frames * channels` readable `f32` samples that the
/// caller still owns; this call only reads them.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn analysis_push(handle: u32, ptr: *const f32, frames: u32) -> i32 {
    let result = ANALYSES.with_object(handle, |session| {
        let Some(len) = (frames as usize)
            .checked_mul(session.channels() as usize)
            .filter(|&samples| samples <= (isize::MAX as usize) / size_of::<f32>())
        else {
            return Err(DspError::BadArgument);
        };
        let interleaved = if len == 0 {
            &[]
        } else if ptr.is_null() {
            return Err(DspError::BadArgument);
        } else {
            // SAFETY: `ptr` is non-null, `len * size_of::<f32>() <= isize::MAX`,
            // and the caller guarantees `len` readable samples.
            unsafe { std::slice::from_raw_parts(ptr, len) }
        };
        session.push(interleaved)
    });
    DspError::status(result.and_then(|inner| inner))
}

/// Sets the band layout the session's spectrum analyser measures on
/// (`SPECTRUM_LAYOUT` in `packages/dsp/src/spectrum.ts`, the single source).
/// `BadArgument` unless `handle` was opened with the spectrum flag, this is
/// the session's first call to it, and every argument is in range. Must run
/// before the first `analysis_push`.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_spectrum_layout(
    handle: u32,
    bands: u32,
    low_hz: f32,
    high_hz: f32,
    fft_size: u32,
    tilt_db_per_octave: f32,
    floor_db: f32,
) -> i32 {
    let result = ANALYSES.with_object(handle, |session| {
        session.set_spectrum_layout(
            bands,
            low_hz,
            high_hz,
            fft_size,
            tilt_db_per_octave,
            floor_db,
        )
    });
    DspError::status(result.and_then(|inner| inner))
}

/// Flushes peaks' trailing partial bin and computes the offline analyses the
/// session's flags named; their getters read empty until this runs, and
/// only the first call computes. The spectrum average needs no flush: it is
/// already current on every call.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_finish(handle: u32) -> i32 {
    let result = ANALYSES.with_object(handle, analysis::Session::finish);
    DspError::status(result.and_then(|inner| inner))
}

/// Frames received so far; playing time is `analysis_frames(h) / rate`.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_frames(handle: u32) -> u64 {
    ANALYSES
        .with_object(handle, |session| session.frames())
        .unwrap_or(0)
}

/// One magnitude per 50 ms of playing time, 0..1, valid until the next call
/// on `handle`. Null when `handle` was not opened with the peaks flag.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_peaks_ptr(handle: u32) -> *const f32 {
    ANALYSES
        .with_object(handle, |session| session.peaks_ptr())
        .unwrap_or(std::ptr::null())
}

/// The length `analysis_peaks_ptr` points `analysis_peaks_len` samples into.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_peaks_len(handle: u32) -> u32 {
    ANALYSES
        .with_object(handle, |session| session.peaks_len())
        .unwrap_or(0)
}

/// Integrated loudness in LUFS; `-inf` for silence or when `handle` was not
/// opened with the loudness flag.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_lufs(handle: u32) -> f64 {
    ANALYSES
        .with_object(handle, |session| session.lufs())
        .unwrap_or(f64::NEG_INFINITY)
}

/// Loudness range in LU.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_lra(handle: u32) -> f64 {
    ANALYSES
        .with_object(handle, |session| session.lra())
        .unwrap_or(0.0)
}

/// `20·log10(max true peak)` in dBTP; `-inf` for silence.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_true_peak_db(handle: u32) -> f64 {
    ANALYSES
        .with_object(handle, |session| session.true_peak_db())
        .unwrap_or(f64::NEG_INFINITY)
}

/// The long-term average spectrum, tilted dB on the layout
/// `analysis_spectrum_layout` set, one value per band, recomputed fresh on
/// every call so it is always current, valid until the next call on
/// `handle`. Null before the first full window, or without the spectrum
/// flag.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_spectrum_ptr(handle: u32) -> *const f32 {
    ANALYSES
        .with_object(handle, |session| session.spectrum_ptr())
        .unwrap_or(std::ptr::null())
}

/// The length `analysis_spectrum_ptr` points `analysis_spectrum_len` bands into.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_spectrum_len(handle: u32) -> u32 {
    ANALYSES
        .with_object(handle, |session| session.spectrum_len())
        .unwrap_or(0)
}

/// A pointer to 3 `f32`s — momentary LUFS, short-term LUFS, sample peak in
/// dBFS — for the newest 10 ms hop the session's live flag closed, or 0 when
/// none has closed since the last call.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_take_loudness(handle: u32) -> *const f32 {
    ANALYSES
        .with_object(handle, analysis::Session::take_loudness)
        .ok()
        .flatten()
        .unwrap_or(std::ptr::null())
}

/// A pointer to the newest spectrum window's band levels (as many as
/// `analysis_spectrum_layout` set `bands` to) for the session's live flag,
/// or 0 when no window has closed since the last call.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_take_spectrum(handle: u32) -> *const f32 {
    ANALYSES
        .with_object(handle, analysis::Session::take_spectrum)
        .ok()
        .flatten()
        .unwrap_or(std::ptr::null())
}

/// Closes an `Analysis` session.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_free(handle: u32) -> i32 {
    ANALYSES.close(handle)
}

// ---- chain_*: the Lab's playback chain (`play::chain::Chain`) ---------------

thread_local! {
    static CHAINS: RefCell<Registry<play::chain::Chain>> = const { RefCell::new(Registry::new()) };
}

/// The status `chain_*` exports that return a count report on failure: the
/// error's code, negated.
fn negative_status(error: DspError) -> i32 {
    -(error as i32)
}

/// Makes a chain for a context at `rate` Hz (8,000 to 384,000), with every
/// parameter at its default. Returns 0 and records `BadArgument` for another
/// rate.
#[unsafe(no_mangle)]
pub extern "C" fn chain_new(rate: u32) -> u32 {
    CHAINS.open(play::chain::Chain::new(rate))
}

/// Sets parameter `param` (a `ParamId`) to `value`. `BadArgument` when the
/// parameter is unknown or the value is outside its domain.
#[unsafe(no_mangle)]
pub extern "C" fn chain_set(handle: u32, param: u32, value: f32) -> i32 {
    DspError::status(
        CHAINS
            .with_object(handle, |chain| chain.set(param, value))
            .and_then(|set| set),
    )
}

/// Bypasses block `block` (a `BlockId`) when `bypassed` is non-zero, or
/// engages it. The change fades across the next quantum.
#[unsafe(no_mangle)]
pub extern "C" fn chain_set_bypass(handle: u32, block: u32, bypassed: u32) -> i32 {
    DspError::status(
        CHAINS
            .with_object(handle, |chain| chain.set_bypass(block, bypassed != 0))
            .and_then(|set| set),
    )
}

/// Replaces the EQ's parametric bands with 31 gains in dB, one per ISO
/// 1/3-octave band from 20 Hz to 20 kHz, clamped to ±12 dB; `len` 0 restores
/// the bands. `BadArgument` for any other length or a non-finite gain.
///
/// # Safety
///
/// When `len` is not 0, `gains` points at `len` readable `f32`s.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn chain_set_eq_curve(handle: u32, gains: *const f32, len: usize) -> i32 {
    let gains = if len == 0 {
        None
    } else if gains.is_null() {
        return DspError::BadArgument as i32;
    } else {
        // SAFETY: the caller guarantees `len` readable samples at `gains`.
        Some(unsafe { std::slice::from_raw_parts(gains, len) })
    };
    DspError::status(
        CHAINS
            .with_object(handle, |chain| chain.set_eq_curve(gains))
            .and_then(|set| set),
    )
}

/// Fills `output_frames` interleaved stereo frames at `output` from the
/// interleaved stereo source at `input`, which holds the `input_frames`
/// frames from the read position to the end of the source. Returns the
/// source frames read, which the host advances its read position by, or a
/// negated `DspError` code. The chain reads silence past `input_frames`, so
/// its tail plays out after the source ends.
///
/// # Safety
///
/// `input` points at `input_frames × 2` readable `f32`s and `output` at
/// `output_frames × 2` writable `f32`s (either may be null when its count is
/// 0), and the two do not overlap.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn chain_process(
    handle: u32,
    input: *const f32,
    input_frames: usize,
    output: *mut f32,
    output_frames: usize,
) -> i32 {
    const CHANNELS: usize = play::CHANNELS;
    let (Some(input_len), Some(output_len)) = (
        input_frames.checked_mul(CHANNELS),
        output_frames.checked_mul(CHANNELS),
    ) else {
        return negative_status(DspError::BadArgument);
    };
    if (input.is_null() && input_len > 0) || (output.is_null() && output_len > 0) {
        return negative_status(DspError::BadArgument);
    }
    let source: &[f32] = if input_len == 0 {
        &[]
    } else {
        // SAFETY: non-null, and the caller guarantees `input_len` readable samples.
        unsafe { std::slice::from_raw_parts(input, input_len) }
    };
    let out: &mut [f32] = if output_len == 0 {
        &mut []
    } else {
        // SAFETY: non-null, and the caller guarantees `output_len` writable
        // samples that do not overlap `source`.
        unsafe { std::slice::from_raw_parts_mut(output, output_len) }
    };
    match CHAINS.with_object(handle, |chain| chain.process(source, out)) {
        Ok(consumed) => i32::try_from(consumed).unwrap_or(i32::MAX),
        Err(error) => negative_status(error),
    }
}

/// Flushes every buffer and signal state and keeps the parameters, for a seek.
#[unsafe(no_mangle)]
pub extern "C" fn chain_reset(handle: u32) -> i32 {
    DspError::status(CHAINS.with_object(handle, |chain| chain.reset()))
}

/// Output frames between a source frame being read and being heard, at the
/// current settings, or a negated `DspError` code.
#[unsafe(no_mangle)]
pub extern "C" fn chain_latency(handle: u32) -> i32 {
    match CHAINS.with_object(handle, |chain| chain.latency()) {
        Ok(frames) => i32::try_from(frames).unwrap_or(i32::MAX),
        Err(error) => negative_status(error),
    }
}

/// The current reading of meter `meter` (a `MeterId`), or NaN for an unknown
/// handle or meter.
#[unsafe(no_mangle)]
pub extern "C" fn chain_meter(handle: u32, meter: u32) -> f32 {
    CHAINS
        .with_object(handle, |chain| chain.meter(meter))
        .ok()
        .flatten()
        .unwrap_or(f32::NAN)
}

#[unsafe(no_mangle)]
pub extern "C" fn chain_free(handle: u32) -> i32 {
    CHAINS.close(handle)
}

// ---- The offline analyses: `analysis_*` getters filled by `analysis_finish`,
// and `offline_*` comparisons of two versions' stored features --------------

/// A fixed-size result's pointer, or null.
fn result_ptr<const N: usize>(result: Option<&[f32; N]>) -> *const f32 {
    result.map_or(std::ptr::null(), |values| values.as_ptr())
}

/// Reads one slice an offline getter returns from `handle`'s session: its
/// pointer (null when empty or unknown) or its length.
fn offline_slice<T>(
    handle: u32,
    read: impl FnOnce(&analysis::offline::Offline) -> &[T],
) -> (*const T, u32) {
    ANALYSES
        .with_object(handle, |session| {
            let values = read(session.offline());
            let ptr = if values.is_empty() {
                std::ptr::null()
            } else {
                values.as_ptr()
            };
            (ptr, values.len() as u32)
        })
        .unwrap_or((std::ptr::null(), 0))
}

/// Three `f32`s — BPM (one decimal), the first beat in ms, confidence 0..1 —
/// or null without the tempo flag, before `analysis_finish`, or when the
/// stream shows no periodicity.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_tempo(handle: u32) -> *const f32 {
    ANALYSES
        .with_object(handle, |session| result_ptr(session.offline().tempo()))
        .unwrap_or(std::ptr::null())
}

/// Three `f32`s — the tonic's pitch class (C = 0), minor (0 or 1),
/// confidence 0..1 — or null as for `analysis_tempo`.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_key(handle: u32) -> *const f32 {
    ANALYSES
        .with_object(handle, |session| result_ptr(session.offline().key()))
        .unwrap_or(std::ptr::null())
}

/// `[startMs, endMs, group]` per section, groups numbered from 0 in order of
/// first appearance; `analysis_sections_len` values.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_sections_ptr(handle: u32) -> *const f32 {
    offline_slice(handle, analysis::offline::Offline::sections).0
}

#[unsafe(no_mangle)]
pub extern "C" fn analysis_sections_len(handle: u32) -> u32 {
    offline_slice(handle, analysis::offline::Offline::sections).1
}

/// The spectrogram tile as bytes: 160 log bands (20 Hz to 20 kHz, lowest
/// first) per 50 ms column, column after column, 0 for −80 dBFS and 255
/// for 0 dBFS; `analysis_spectrogram_len` bytes.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_spectrogram_ptr(handle: u32) -> *const u8 {
    offline_slice(handle, analysis::offline::Offline::spectrogram).0
}

#[unsafe(no_mangle)]
pub extern "C" fn analysis_spectrogram_len(handle: u32) -> u32 {
    offline_slice(handle, analysis::offline::Offline::spectrogram).1
}

/// Short-term LUFS per second, one decimal, `-inf` where gated.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_loudness_curve_ptr(handle: u32) -> *const f32 {
    offline_slice(handle, |offline| {
        offline.timeline().map_or(&[], |t| t.loudness_curve())
    })
    .0
}

#[unsafe(no_mangle)]
pub extern "C" fn analysis_loudness_curve_len(handle: u32) -> u32 {
    offline_slice(handle, |offline| {
        offline.timeline().map_or(&[], |t| t.loudness_curve())
    })
    .1
}

/// L/R Pearson correlation per second, −1..1, two decimals.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_correlation_curve_ptr(handle: u32) -> *const f32 {
    offline_slice(handle, |offline| {
        offline.timeline().map_or(&[], |t| t.correlation_curve())
    })
    .0
}

#[unsafe(no_mangle)]
pub extern "C" fn analysis_correlation_curve_len(handle: u32) -> u32 {
    offline_slice(handle, |offline| {
        offline.timeline().map_or(&[], |t| t.correlation_curve())
    })
    .1
}

/// `[binIndex, samples, over]` per 50 ms bin that clipped: the frames in
/// runs of three or more at full scale, and 1 when its true peak passed
/// 0 dBTP.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_clipping_ptr(handle: u32) -> *const f32 {
    offline_slice(handle, |offline| {
        offline.timeline().map_or(&[], |t| t.clipping())
    })
    .0
}

#[unsafe(no_mangle)]
pub extern "C" fn analysis_clipping_len(handle: u32) -> u32 {
    offline_slice(handle, |offline| {
        offline.timeline().map_or(&[], |t| t.clipping())
    })
    .1
}

/// Two `f32`s — leading and trailing milliseconds below −60 dBFS — or null
/// without the silence flag or before `analysis_finish`.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_silence(handle: u32) -> *const f32 {
    ANALYSES
        .with_object(handle, |session| {
            let timeline = session
                .offline()
                .timeline()
                .filter(|t| t.measures().silence);
            result_ptr(timeline.map(analysis::offline::Timeline::silence))
        })
        .unwrap_or(std::ptr::null())
}

/// The dominant pitch in Hz per 50 ms, one decimal, 0 where unvoiced.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_pitch_track_ptr(handle: u32) -> *const f32 {
    offline_slice(handle, analysis::offline::Offline::pitch_track).0
}

#[unsafe(no_mangle)]
pub extern "C" fn analysis_pitch_track_len(handle: u32) -> u32 {
    offline_slice(handle, analysis::offline::Offline::pitch_track).1
}

/// Feature series `series` as bytes quantised over its own range (0 the
/// onset envelope at 100 Hz, 1 the 40 log-mel band means per second, 2 the
/// 12-bin chroma per second, the fingerprint); null for another series,
/// without the features flag, or before `analysis_finish`.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_feature_ptr(handle: u32, series: u32) -> *const u8 {
    let Ok(series) = analysis::offline::diff::Series::from_id(series) else {
        return std::ptr::null();
    };
    offline_slice(handle, |offline| &offline.feature(series).bytes).0
}

#[unsafe(no_mangle)]
pub extern "C" fn analysis_feature_len(handle: u32, series: u32) -> u32 {
    let Ok(series) = analysis::offline::diff::Series::from_id(series) else {
        return 0;
    };
    offline_slice(handle, |offline| &offline.feature(series).bytes).1
}

/// Two `f32`s, the minimum and maximum the series was quantised over (byte 0
/// and byte 255), or null for another series.
#[unsafe(no_mangle)]
pub extern "C" fn analysis_feature_range(handle: u32, series: u32) -> *const f32 {
    let Ok(series) = analysis::offline::diff::Series::from_id(series) else {
        return std::ptr::null();
    };
    ANALYSES
        .with_object(handle, |session| {
            result_ptr(Some(&session.offline().feature(series).range))
        })
        .unwrap_or(std::ptr::null())
}

thread_local! {
    static FEATURES: RefCell<Registry<analysis::offline::diff::Features>> = const { RefCell::new(Registry::new()) };
    static DIFFS: RefCell<Registry<analysis::offline::diff::Diff>> = const { RefCell::new(Registry::new()) };
}

/// Opens an empty feature set for one version, to load stored series into.
#[unsafe(no_mangle)]
pub extern "C" fn offline_features_new() -> u32 {
    FEATURES.open(Ok(analysis::offline::diff::Features::default()))
}

/// Loads `len` bytes of series `series` (as `analysis_feature_ptr` numbers
/// them), quantised over `[min, max]`. `BadArgument` for an unknown series, a
/// length that is not whole rows, or a range that is not finite and ordered.
///
/// # Safety
///
/// When `len` is not 0, `bytes` points at `len` readable bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn offline_features_set(
    handle: u32,
    series: u32,
    bytes: *const u8,
    len: usize,
    min: f32,
    max: f32,
) -> i32 {
    let series = match analysis::offline::diff::Series::from_id(series) {
        Ok(series) => series,
        Err(error) => return error as i32,
    };
    let values: &[u8] = if len == 0 {
        &[]
    } else if bytes.is_null() {
        return DspError::BadArgument as i32;
    } else {
        // SAFETY: the caller guarantees `len` readable bytes at `bytes`.
        unsafe { std::slice::from_raw_parts(bytes, len) }
    };
    DspError::status(
        FEATURES
            .with_object(handle, |features| features.set(series, values, min, max))
            .and_then(|set| set),
    )
}

/// Loads the version's short-term LUFS per second (`-inf` or NaN where
/// gated), which the loudness delta reads.
///
/// # Safety
///
/// When `len` is not 0, `lufs` points at `len` readable `f32`s.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn offline_features_set_loudness(
    handle: u32,
    lufs: *const f32,
    len: usize,
) -> i32 {
    let values: &[f32] = if len == 0 {
        &[]
    } else if lufs.is_null() {
        return DspError::BadArgument as i32;
    } else {
        // SAFETY: the caller guarantees `len` readable samples at `lufs`.
        unsafe { std::slice::from_raw_parts(lufs, len) }
    };
    DspError::status(FEATURES.with_object(handle, |features| features.set_loudness(values)))
}

#[unsafe(no_mangle)]
pub extern "C" fn offline_features_free(handle: u32) -> i32 {
    FEATURES.close(handle)
}

/// Runs `f` on the two feature sets `a` and `b` name, which may be the same.
fn with_feature_pair<R>(
    a: u32,
    b: u32,
    f: impl FnOnce(&analysis::offline::diff::Features, &analysis::offline::diff::Features) -> R,
) -> Result<R, DspError> {
    FEATURES.with_borrow(|registry| match (registry.get(a), registry.get(b)) {
        (Some(a), Some(b)) => Ok(f(a, b)),
        _ => Err(DspError::BadHandle),
    })
}

/// The offset in ms at which version `b` best matches version `a` by their
/// onset envelopes (positive when `b` plays the same material later), or
/// `i32::MIN` when nothing within ±30 s correlates at 0.3 or when either
/// handle is unknown.
#[unsafe(no_mangle)]
pub extern "C" fn offline_align(a: u32, b: u32) -> i32 {
    with_feature_pair(a, b, analysis::offline::diff::align)
        .ok()
        .flatten()
        .unwrap_or(i32::MIN)
}

/// Compares version `a` with version `b` placed `offset_ms` later. Returns
/// the comparison's handle, or 0 with `BadHandle` recorded.
#[unsafe(no_mangle)]
pub extern "C" fn offline_diff_new(a: u32, b: u32, offset_ms: i32) -> u32 {
    DIFFS.open(with_feature_pair(a, b, |a, b| {
        analysis::offline::diff::diff(a, b, offset_ms)
    }))
}

/// The change per second of `a`, 0..1, two decimals, 1 where `b` has no
/// counterpart; `offline_diff_change_len` values.
#[unsafe(no_mangle)]
pub extern "C" fn offline_diff_change_ptr(handle: u32) -> *const f32 {
    DIFFS
        .with_object(handle, |diff| diff.change.as_ptr())
        .unwrap_or(std::ptr::null())
}

#[unsafe(no_mangle)]
pub extern "C" fn offline_diff_change_len(handle: u32) -> u32 {
    DIFFS
        .with_object(handle, |diff| diff.change.len() as u32)
        .unwrap_or(0)
}

/// The loudness change per second of `a` in LU, one decimal; empty unless
/// both feature sets had loudness loaded.
#[unsafe(no_mangle)]
pub extern "C" fn offline_diff_loudness_ptr(handle: u32) -> *const f32 {
    DIFFS
        .with_object(handle, |diff| diff.loudness_delta.as_ptr())
        .unwrap_or(std::ptr::null())
}

#[unsafe(no_mangle)]
pub extern "C" fn offline_diff_loudness_len(handle: u32) -> u32 {
    DIFFS
        .with_object(handle, |diff| diff.loudness_delta.len() as u32)
        .unwrap_or(0)
}

/// Five `f32`s — changed seconds, changed share, the loudest change's start
/// and end in ms (−1 when none), fingerprint similarity (NaN unless both
/// sets had chroma loaded) — or null for an unknown handle.
#[unsafe(no_mangle)]
pub extern "C" fn offline_diff_summary(handle: u32) -> *const f32 {
    DIFFS
        .with_object(handle, |diff| diff.summary.as_ptr())
        .unwrap_or(std::ptr::null())
}

#[unsafe(no_mangle)]
pub extern "C" fn offline_diff_free(handle: u32) -> i32 {
    DIFFS.close(handle)
}

fn host_layout(bytes: usize) -> Option<Layout> {
    if bytes == 0 {
        DspError::BadArgument.record();
        return None;
    }
    let layout = Layout::from_size_align(bytes, ALIGN).ok();
    if layout.is_none() {
        DspError::OutOfMemory.record();
    }
    layout
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_abi_version() {
        assert_eq!(dsp_abi_version(), ABI_VERSION);
    }

    #[test]
    fn allocating_zero_bytes_fails_with_bad_argument() {
        assert!(dsp_alloc(0).is_null());
        assert_eq!(dsp_last_error(), DspError::BadArgument as i32);
    }

    #[test]
    fn allocating_an_impossible_size_fails_with_out_of_memory() {
        assert!(dsp_alloc(usize::MAX).is_null());
        assert_eq!(dsp_last_error(), DspError::OutOfMemory as i32);
    }

    #[test]
    fn an_allocation_is_aligned_and_writable_until_freed() {
        let bytes = 64 * size_of::<f32>();
        let ptr = dsp_alloc(bytes);
        assert!(!ptr.is_null());
        assert_eq!(ptr as usize % ALIGN, 0);
        // SAFETY: `ptr` holds `bytes` writable bytes until the free below.
        unsafe {
            let samples = std::slice::from_raw_parts_mut(ptr.cast::<f32>(), 64);
            samples.fill(0.25);
            assert_eq!(samples[63], 0.25);
            dsp_free(ptr, bytes);
        }
    }

    #[test]
    fn freeing_null_or_zero_bytes_does_nothing() {
        // SAFETY: both calls are the documented no-op cases.
        unsafe {
            dsp_free(std::ptr::null_mut(), 16);
            dsp_free(std::ptr::NonNull::<u8>::dangling().as_ptr(), 0);
        }
    }

    #[test]
    fn analysis_push_rejects_null_pointer_with_nonzero_frames() {
        let handle = analysis_new(48_000, 2, 1);
        assert_ne!(handle, 0);
        // SAFETY: null with zero frames is a documented empty slice; null with
        // non-zero frames is rejected before `from_raw_parts`.
        unsafe {
            assert_eq!(analysis_push(handle, std::ptr::null(), 0), 0);
            assert_eq!(
                analysis_push(handle, std::ptr::null(), 128),
                DspError::BadArgument as i32
            );
        }
        assert_eq!(analysis_free(handle), 0);
    }
}
