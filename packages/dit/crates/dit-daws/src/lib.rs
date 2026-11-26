//! Every DAW module a dit build knows about. `dit-core` cannot depend on the module crates, so the registry lives
//! here; adding a DAW is one crate and one line in `registry`.

use dit_core::Registry;

pub fn registry() -> Registry {
    Registry::new(vec![&dit_daw_ableton::Ableton]).expect("the registered DAW modules do not clash")
}
