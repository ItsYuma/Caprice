#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == caprice_desktop::SPEECH_WORKER_FLAG) {
        std::process::exit(caprice_desktop::speech_worker());
    }
    caprice_desktop::run()
}
