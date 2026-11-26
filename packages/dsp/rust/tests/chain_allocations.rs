//! A chain allocates when it is made and never while it processes. This is
//! its own test binary because it replaces the global allocator with one
//! that counts, and a single test keeps other threads' allocations out of
//! the count.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

use projammr_dsp::play::CHANNELS;
use projammr_dsp::play::chain::{Chain, QUANTUM};
use projammr_dsp::play::params::{BlockId, ParamId};
use projammr_dsp::play::pitch::TimeMode;
use projammr_dsp::play::stereo::StereoMode;

struct Counting;

static ALLOCATIONS: AtomicUsize = AtomicUsize::new(0);

// SAFETY: every call forwards to the system allocator unchanged.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::SeqCst);
        // SAFETY: the caller upholds `alloc`'s contract, passed on as is.
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        // SAFETY: the caller upholds `dealloc`'s contract, passed on as is.
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        ALLOCATIONS.fetch_add(1, Ordering::SeqCst);
        // SAFETY: the caller upholds `realloc`'s contract, passed on as is.
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

#[test]
fn processing_never_allocates_whatever_the_settings() {
    let rate = 48_000;
    let source: Vec<f32> = (0..20 * rate)
        .flat_map(|i| {
            let v = (i as f32 * 0.03).sin() * 0.5;
            [v, -v]
        })
        .collect();
    let mut out = vec![0.0f32; QUANTUM * CHANNELS];
    let made = ALLOCATIONS.load(Ordering::SeqCst);
    let mut chain = Chain::new(rate as u32).unwrap();
    // The counter sees the chain's own buffers being made.
    assert!(ALLOCATIONS.load(Ordering::SeqCst) > made);
    let mut position = 0;

    let before = ALLOCATIONS.load(Ordering::SeqCst);
    for quantum in 0..6000usize {
        match quantum % 1000 {
            0 => {
                for &block in BlockId::ALL {
                    chain.set_bypass(block as u32, false).unwrap();
                }
                chain
                    .set(
                        ParamId::TimeMode as u32,
                        TimeMode::Independent as usize as f32,
                    )
                    .unwrap();
                chain.set(ParamId::TimeSpeed as u32, 0.8).unwrap();
                chain.set(ParamId::TimePitchSemitones as u32, 3.0).unwrap();
                chain.set(ParamId::BandMidSolo as u32, 1.0).unwrap();
            }
            250 => {
                chain
                    .set(ParamId::TimeMode as u32, TimeMode::Linked as usize as f32)
                    .unwrap();
                chain.set(ParamId::TimeSpeed as u32, 1.3).unwrap();
                chain.set_eq_curve(Some(&[3.0; 31])).unwrap();
                chain
                    .set(ParamId::StereoMode as u32, StereoMode::Side as usize as f32)
                    .unwrap();
                chain.set(ParamId::Device as u32, 4.0).unwrap();
            }
            500 => {
                chain.set(ParamId::TimeSpeed as u32, 1.0).unwrap();
                chain.set_eq_curve(None).unwrap();
                chain.set(ParamId::ReverbPreset as u32, 2.0).unwrap();
                chain.set(ParamId::Device as u32, 5.0).unwrap();
            }
            750 => {
                chain.reset();
                for &block in &BlockId::ALL[1..] {
                    chain.set_bypass(block as u32, true).unwrap();
                }
            }
            _ => {}
        }
        let start = (position * CHANNELS).min(source.len());
        position += chain.process(&source[start..], &mut out);
        assert!(chain.meter(0).is_some());
    }
    let allocated = ALLOCATIONS.load(Ordering::SeqCst) - before;
    assert!(position > 0);
    assert_eq!(allocated, 0, "processing allocated {allocated} times");
}
