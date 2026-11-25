//! Tauri IPC commands, grouped by domain.

pub mod academic;
pub mod code;
pub mod library;
pub mod session;
pub mod settings;
pub mod study;

pub type CmdResult<T> = Result<T, String>;

pub fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
