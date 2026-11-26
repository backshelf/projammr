//! Objects behind `u32` handles: one slab per object kind.
//!
//! A handle's low 16 bits are its slot index plus one, so 0 is never a handle
//! and an export can return it to mean failure. Its high 16 bits are the
//! slot's generation, which advances every time the slot is freed, so a handle
//! kept after `*_free` misses the object that later reuses the slot rather
//! than reaching it. The generation wraps after 65,536 reuses of one slot.

use std::cell::RefCell;
use std::thread::LocalKey;

use crate::error::DspError;

const INDEX_BITS: u32 = 16;
const INDEX_MASK: u32 = (1 << INDEX_BITS) - 1;
/// Live objects one kind can hold: the largest index plus one still fits the index bits.
pub const CAPACITY: usize = INDEX_MASK as usize;

struct Slot<T> {
    generation: u16,
    // Boxed so an object never moves while it lives, whatever the slab does:
    // a `*_ptr` export may hand the host an address inside it.
    value: Option<Box<T>>,
}

pub struct Registry<T> {
    slots: Vec<Slot<T>>,
    free: Vec<usize>,
}

impl<T> Registry<T> {
    pub const fn new() -> Self {
        Self {
            slots: Vec::new(),
            free: Vec::new(),
        }
    }

    /// Stores `value` and returns its handle, or `None` once the kind holds
    /// [`CAPACITY`] objects.
    pub fn insert(&mut self, value: T) -> Option<u32> {
        let index = match self.free.pop() {
            Some(index) => index,
            None if self.slots.len() < CAPACITY => {
                self.slots.push(Slot {
                    generation: 0,
                    value: None,
                });
                self.slots.len() - 1
            }
            None => return None,
        };
        let slot = &mut self.slots[index];
        slot.value = Some(Box::new(value));
        Some(join(index, slot.generation))
    }

    pub fn get(&self, handle: u32) -> Option<&T> {
        let (index, generation) = split(handle)?;
        let slot = self.slots.get(index)?;
        if slot.generation != generation {
            return None;
        }
        slot.value.as_deref()
    }

    pub fn get_mut(&mut self, handle: u32) -> Option<&mut T> {
        let (index, generation) = split(handle)?;
        let slot = self.slots.get_mut(index)?;
        if slot.generation != generation {
            return None;
        }
        slot.value.as_deref_mut()
    }

    /// Takes the object out and frees its slot; `None` when the handle names
    /// no live object, including one already removed.
    pub fn remove(&mut self, handle: u32) -> Option<Box<T>> {
        let (index, generation) = split(handle)?;
        let slot = self.slots.get_mut(index)?;
        if slot.generation != generation {
            return None;
        }
        let value = slot.value.take()?;
        slot.generation = slot.generation.wrapping_add(1);
        self.free.push(index);
        Some(value)
    }

    pub fn len(&self) -> usize {
        self.slots.len() - self.free.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

impl<T> Default for Registry<T> {
    fn default() -> Self {
        Self::new()
    }
}

fn join(index: usize, generation: u16) -> u32 {
    // `index < CAPACITY`, so `index + 1` fits the index bits.
    (u32::from(generation) << INDEX_BITS) | (index as u32 + 1)
}

fn split(handle: u32) -> Option<(usize, u16)> {
    let index = (handle & INDEX_MASK).checked_sub(1)?;
    Some((index as usize, (handle >> INDEX_BITS) as u16))
}

/// A kind's registry as its exports reach it, declared once per kind:
///
/// ```text
/// thread_local! {
///     static SESSIONS: RefCell<Registry<Session>> = const { RefCell::new(Registry::new()) };
/// }
/// ```
///
/// `thread_local!` on wasm32-unknown-unknown, which has no threads, is a plain
/// `static` cell; natively it keeps each test thread's objects apart.
pub type Table<T> = LocalKey<RefCell<Registry<T>>>;

/// The shape of every `*_new`, `*_free` and per-handle export.
pub trait Handles<T> {
    /// For `*_new`: stores what the constructor made and returns its handle,
    /// or records the constructor's error (or `OutOfMemory` when the table is
    /// full) and returns 0.
    fn open(&'static self, made: Result<T, DspError>) -> u32;

    /// For `*_free`: drops the object and returns 0, or `BadHandle` when the
    /// handle names no live object.
    fn close(&'static self, handle: u32) -> i32;

    /// Runs `f` on the object `handle` names, or fails with `BadHandle`. The
    /// table stays borrowed while `f` runs, so `f` must not reach the same
    /// table again.
    fn with_object<R>(
        &'static self,
        handle: u32,
        f: impl FnOnce(&mut T) -> R,
    ) -> Result<R, DspError>;
}

impl<T: 'static> Handles<T> for Table<T> {
    fn open(&'static self, made: Result<T, DspError>) -> u32 {
        let handle = made.and_then(|value| {
            self.with_borrow_mut(|registry| registry.insert(value))
                .ok_or(DspError::OutOfMemory)
        });
        handle.unwrap_or_else(|error| {
            error.record();
            0
        })
    }

    fn close(&'static self, handle: u32) -> i32 {
        // The object drops after the borrow ends, so its `Drop` may use any table.
        let removed = self.with_borrow_mut(|registry| registry.remove(handle));
        DspError::status(removed.map(drop).ok_or(DspError::BadHandle))
    }

    fn with_object<R>(
        &'static self,
        handle: u32,
        f: impl FnOnce(&mut T) -> R,
    ) -> Result<R, DspError> {
        self.with_borrow_mut(|registry| registry.get_mut(handle).map(f))
            .ok_or(DspError::BadHandle)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_are_non_zero_and_distinct() {
        let mut registry = Registry::new();
        let a = registry.insert("a").unwrap();
        let b = registry.insert("b").unwrap();
        assert_ne!(a, 0);
        assert_ne!(b, 0);
        assert_ne!(a, b);
        assert_eq!(registry.get(a), Some(&"a"));
        assert_eq!(registry.get(b), Some(&"b"));
        assert_eq!(registry.len(), 2);
    }

    #[test]
    fn get_mut_reaches_the_stored_object() {
        let mut registry = Registry::new();
        let handle = registry.insert(1).unwrap();
        *registry.get_mut(handle).unwrap() += 1;
        assert_eq!(registry.get(handle), Some(&2));
    }

    #[test]
    fn removing_twice_fails_the_second_time() {
        let mut registry = Registry::new();
        let handle = registry.insert(7).unwrap();
        assert_eq!(registry.remove(handle).as_deref(), Some(&7));
        assert!(registry.remove(handle).is_none());
        assert!(registry.is_empty());
    }

    #[test]
    fn a_stale_handle_misses_the_object_that_reuses_its_slot() {
        let mut registry = Registry::new();
        let stale = registry.insert("first").unwrap();
        registry.remove(stale).unwrap();
        let fresh = registry.insert("second").unwrap();

        assert_ne!(stale, fresh);
        assert_eq!(registry.get(stale), None);
        assert_eq!(registry.get_mut(stale), None);
        assert!(registry.remove(stale).is_none());
        assert_eq!(registry.get(fresh), Some(&"second"));
    }

    #[test]
    fn zero_and_unknown_handles_name_nothing() {
        let mut registry = Registry::new();
        let handle = registry.insert(()).unwrap();
        assert_eq!(registry.get(0), None);
        assert_eq!(registry.get(handle + 1), None);
        assert_eq!(registry.get(u32::MAX), None);
        assert!(registry.remove(0).is_none());
    }

    #[test]
    fn insert_fails_at_capacity_and_recovers_after_a_removal() {
        let mut registry = Registry::new();
        let handles: Vec<u32> = (0..CAPACITY)
            .map(|_| registry.insert(()).unwrap())
            .collect();
        assert_eq!(registry.insert(()), None);
        registry.remove(handles[100]).unwrap();
        assert!(registry.insert(()).is_some());
    }

    struct Probe(i32);

    thread_local! {
        static PROBES: RefCell<Registry<Probe>> = const { RefCell::new(Registry::new()) };
    }

    #[test]
    fn open_returns_a_handle_that_with_object_reaches() {
        let handle = PROBES.open(Ok(Probe(3)));
        assert_ne!(handle, 0);
        assert_eq!(PROBES.with_object(handle, |probe| probe.0), Ok(3));
    }

    #[test]
    fn open_records_the_constructor_error_and_returns_zero() {
        assert_eq!(PROBES.open(Err(DspError::Unsupported)), 0);
        assert_eq!(DspError::last(), DspError::Unsupported);
    }

    #[test]
    fn close_frees_once_then_reports_a_bad_handle() {
        let handle = PROBES.open(Ok(Probe(0)));
        assert_eq!(PROBES.close(handle), 0);
        assert_eq!(PROBES.close(handle), DspError::BadHandle as i32);
        assert_eq!(
            PROBES.with_object(handle, |probe| probe.0),
            Err(DspError::BadHandle)
        );
    }
}
