use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use handy_keys::{Hotkey, HotkeyId, HotkeyManager, HotkeyState};
use tauri::{AppHandle, Emitter, Manager};

pub const TALK_PRESS: &str = "talk-press";
pub const TALK_RELEASE: &str = "talk-release";
pub const TALK_CANCEL: &str = "talk-cancel";

const TALK_HOLD: Duration = Duration::from_millis(200);
const TALK_POLL: Duration = Duration::from_millis(10);

enum TalkCommand {
    Arm {
        accelerator: String,
        reply: Sender<Result<(), String>>,
    },
    Disarm {
        accelerator: String,
        reply: Sender<Result<(), String>>,
    },
    Limit {
        allowed: Vec<String>,
        reply: Sender<Result<(), String>>,
    },
    Stop,
}

struct TalkGate {
    commands: Sender<TalkCommand>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

struct DownChord<T> {
    id: T,
    at: Instant,
    live: bool,
}

pub(crate) fn install(app: &AppHandle) {
    let (tx, rx) = mpsc::channel();
    let handle = app.clone();
    let Ok(worker) = thread::Builder::new()
        .name("talk-chord".to_string())
        .spawn(move || run(handle, rx))
    else {
        return;
    };

    app.manage(TalkGate {
        commands: tx,
        worker: Mutex::new(Some(worker)),
    });
}

pub(crate) fn shutdown(app: &AppHandle) {
    let Some(gate) = app.try_state::<TalkGate>() else {
        return;
    };

    let _ = gate.commands.send(TalkCommand::Stop);

    let worker = gate.worker.lock().ok().and_then(|mut slot| slot.take());

    if let Some(worker) = worker {
        let _ = worker.join();
    }
}

#[tauri::command]
pub(crate) async fn talk_arm(app: AppHandle, accelerator: String) -> Result<(), String> {
    off_main(move || {
        let (tx, rx) = mpsc::channel();
        send(
            &app,
            TalkCommand::Arm {
                accelerator,
                reply: tx,
            },
        )?;
        rx.recv().map_err(|_| "talk keys stopped".to_string())?
    })
    .await
}

#[tauri::command]
pub(crate) async fn talk_disarm(app: AppHandle, accelerator: String) -> Result<(), String> {
    off_main(move || {
        let (tx, rx) = mpsc::channel();
        send(
            &app,
            TalkCommand::Disarm {
                accelerator,
                reply: tx,
            },
        )?;
        rx.recv().map_err(|_| "talk keys stopped".to_string())?
    })
    .await
}

async fn off_main(
    work: impl FnOnce() -> Result<(), String> + Send + 'static,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|err| err.to_string())?
}

fn send(app: &AppHandle, command: TalkCommand) -> Result<(), String> {
    let gate = app
        .try_state::<TalkGate>()
        .ok_or("talk keys are not available")?;

    gate.commands
        .clone()
        .send(command)
        .map_err(|_| "talk keys stopped".to_string())
}

fn run(app: AppHandle, commands: Receiver<TalkCommand>) {
    let manager = match open_manager() {
        Ok(manager) => manager,
        Err(err) => {
            refuse(commands, err);
            return;
        }
    };
    let mut armed: HashMap<String, HotkeyId> = HashMap::new();
    let mut down: Option<DownChord<HotkeyId>> = None;

    loop {
        while let Some(event) = manager.try_recv() {
            match event.state {
                HotkeyState::Pressed => note_press(&mut down, event.id, Instant::now()),
                HotkeyState::Released => {
                    if note_release(&mut down, event.id) {
                        let _ = app.emit(talk_edge(event.state), ());
                    }
                }
            }
        }

        if mature(&mut down, Instant::now(), TALK_HOLD) {
            let _ = app.emit(talk_edge(HotkeyState::Pressed), ());
        }

        let wait = poll_wait(down.as_ref(), Instant::now());

        match commands.recv_timeout(wait) {
            Ok(TalkCommand::Arm { accelerator, reply }) => {
                let _ = reply.send(arm_chord(&manager, &mut armed, &accelerator));
            }
            Ok(TalkCommand::Disarm { accelerator, reply }) => {
                let _ = reply.send(disarm_chord(&manager, &mut armed, &accelerator));
            }
            Ok(TalkCommand::Limit { allowed, reply }) => {
                let _ = reply.send(limit_chords(&manager, &mut armed, &allowed));
            }
            Ok(TalkCommand::Stop) | Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
}

fn open_manager() -> Result<HotkeyManager, String> {
    if let Ok(manager) = HotkeyManager::new_with_blocking() {
        return Ok(manager);
    }

    HotkeyManager::new().map_err(|err| err.to_string())
}

pub(crate) fn apply_accelerators(app: &AppHandle, allowed: &[String]) {
    let Some(gate) = app.try_state::<TalkGate>() else {
        return;
    };
    let (tx, rx) = mpsc::channel();
    if gate
        .commands
        .send(TalkCommand::Limit {
            allowed: allowed.to_vec(),
            reply: tx,
        })
        .is_err()
    {
        return;
    }
    let _ = rx.recv();
}

fn refuse(commands: Receiver<TalkCommand>, err: String) {
    while let Ok(command) = commands.recv() {
        match command {
            TalkCommand::Arm { reply, .. }
            | TalkCommand::Disarm { reply, .. }
            | TalkCommand::Limit { reply, .. } => {
                let _ = reply.send(Err(err.clone()));
            }
            TalkCommand::Stop => break,
        }
    }
}

fn arm_chord(
    manager: &HotkeyManager,
    armed: &mut HashMap<String, HotkeyId>,
    accelerator: &str,
) -> Result<(), String> {
    if !crate::settings::allowed_talk_accelerators().contains(&accelerator) {
        return Err("talk chord is disabled".to_string());
    }
    register_chord(manager, armed, accelerator)
}

fn limit_chords(
    manager: &HotkeyManager,
    armed: &mut HashMap<String, HotkeyId>,
    allowed: &[String],
) -> Result<(), String> {
    let mut extras = Vec::new();
    for key in armed.keys() {
        if !allowed.contains(key) {
            extras.push(key.clone());
        }
    }
    for extra in extras {
        disarm_chord(manager, armed, &extra)?;
    }
    for accelerator in allowed {
        register_chord(manager, armed, accelerator)?;
    }
    Ok(())
}

fn register_chord(
    manager: &HotkeyManager,
    armed: &mut HashMap<String, HotkeyId>,
    accelerator: &str,
) -> Result<(), String> {
    if armed.contains_key(accelerator) {
        return Ok(());
    }

    let hotkey = talk_hotkey(accelerator)?;
    let id = manager.register(hotkey).map_err(|err| err.to_string())?;
    armed.insert(accelerator.to_string(), id);
    Ok(())
}

fn disarm_chord(
    manager: &HotkeyManager,
    armed: &mut HashMap<String, HotkeyId>,
    accelerator: &str,
) -> Result<(), String> {
    let Some(id) = armed.get(accelerator).copied() else {
        return Ok(());
    };

    manager.unregister(id).map_err(|err| err.to_string())?;
    armed.remove(accelerator);
    Ok(())
}

fn talk_hotkey(accelerator: &str) -> Result<Hotkey, String> {
    accelerator.parse::<Hotkey>().map_err(|err| err.to_string())
}

fn talk_edge(state: HotkeyState) -> &'static str {
    match state {
        HotkeyState::Pressed => TALK_PRESS,
        HotkeyState::Released => TALK_RELEASE,
    }
}

fn note_press<T: PartialEq>(down: &mut Option<DownChord<T>>, id: T, at: Instant) {
    if down.is_none() {
        *down = Some(DownChord {
            id,
            at,
            live: false,
        });
    }
}

fn note_release<T: PartialEq>(down: &mut Option<DownChord<T>>, id: T) -> bool {
    match down {
        Some(current) if current.id == id && current.live => {
            *down = None;
            true
        }
        Some(current) if current.id == id => {
            *down = None;
            false
        }
        _ => false,
    }
}

fn mature<T>(down: &mut Option<DownChord<T>>, now: Instant, hold: Duration) -> bool {
    let Some(current) = down.as_mut() else {
        return false;
    };

    if current.live || now.saturating_duration_since(current.at) < hold {
        return false;
    }

    current.live = true;
    true
}

fn poll_wait<T>(down: Option<&DownChord<T>>, now: Instant) -> Duration {
    let Some(current) = down else {
        return TALK_POLL;
    };

    if current.live {
        return TALK_POLL;
    }

    let left = TALK_HOLD.saturating_sub(now.saturating_duration_since(current.at));

    if left.is_zero() || left > TALK_POLL {
        TALK_POLL
    } else {
        left
    }
}

#[cfg(test)]
#[path = "talk_keys_test.rs"]
mod tests;
