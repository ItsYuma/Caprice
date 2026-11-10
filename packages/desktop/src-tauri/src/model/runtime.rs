use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use reqwest::Client;

const POLL: Duration = Duration::from_millis(20);
const PROBE: Duration = Duration::from_millis(250);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Kind {
    External,
    Ollama,
}

pub(super) struct Plan {
    pub(super) kind: Kind,
    pub(super) endpoint: String,
    pub(super) executable: String,
    pub(super) host: String,
    pub(super) readiness: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SpawnSpec {
    pub(super) executable: String,
    pub(super) args: Vec<String>,
    pub(super) host: String,
}

#[derive(Debug)]
pub(super) enum Action {
    Ready,
    Wait,
    Failed(String),
}

pub(super) trait ChildProc {
    fn running(&mut self) -> bool;
    fn stop(&mut self);
}

struct Owned<C> {
    endpoint: String,
    executable: String,
    child: C,
}

pub(super) struct Gate<C> {
    owned: Option<Owned<C>>,
}

impl<C: ChildProc> Gate<C> {
    fn stop_owned(&mut self) {
        if let Some(mut owned) = self.owned.take() {
            owned.child.stop();
        }
    }

    fn retain(&mut self, endpoint: &str, executable: &str) {
        let stale = match self.owned.as_mut() {
            None => false,
            Some(owned) => {
                let same = owned.endpoint == endpoint && owned.executable == executable;
                let alive = owned.child.running();
                !same || !alive
            }
        };

        if stale {
            self.stop_owned();
        }
    }
}

pub(super) fn advance<C, Spawn>(
    gate: &mut Gate<C>,
    plan: &Plan,
    deadline: Instant,
    endpoint_ready: bool,
    spawned: &mut bool,
    mut spawn: Spawn,
) -> Action
where
    C: ChildProc,
    Spawn: FnMut(&SpawnSpec) -> Result<C, String>,
{
    if plan.kind == Kind::External {
        gate.stop_owned();
        return Action::Ready;
    }

    if endpoint_ready {
        gate.retain(&plan.endpoint, &plan.executable);
        return Action::Ready;
    }

    gate.retain(&plan.endpoint, &plan.executable);

    if gate.owned.is_some() {
        *spawned = true;
    } else if *spawned {
        return Action::Failed("the model runtime exited before it was ready".to_string());
    } else {
        let spec = SpawnSpec {
            executable: plan.executable.clone(),
            args: vec!["serve".to_string()],
            host: plan.host.clone(),
        };

        match spawn(&spec) {
            Ok(mut child) => {
                *spawned = true;

                if !child.running() {
                    child.stop();
                    return Action::Failed(
                        "the model runtime exited before it was ready".to_string(),
                    );
                }

                gate.owned = Some(Owned {
                    endpoint: plan.endpoint.clone(),
                    executable: plan.executable.clone(),
                    child,
                });
            }
            Err(err) => {
                return Action::Failed(format!("the model runtime failed to start: {err}"));
            }
        }
    }

    if Instant::now() >= deadline {
        gate.stop_owned();
        return Action::Failed("the model runtime timed out".to_string());
    }

    Action::Wait
}

pub(crate) struct Brain {
    gate: Mutex<Gate<LiveChild>>,
    http: Client,
}

impl Brain {
    pub(crate) fn new(http: Client) -> Self {
        Self {
            gate: Mutex::new(Gate { owned: None }),
            http,
        }
    }

    pub(crate) async fn ensure(&self, plan: &Plan, ready_for: Duration) -> Result<(), String> {
        if plan.kind == Kind::External {
            lock(&self.gate).stop_owned();
            return Ok(());
        }

        let deadline = Instant::now() + ready_for;
        let mut spawned = false;

        loop {
            let ready = probe_ready(&self.http, &plan.readiness).await;
            let action = {
                let mut gate = lock(&self.gate);
                advance(&mut gate, plan, deadline, ready, &mut spawned, spawn_ollama)
            };

            match action {
                Action::Ready => return Ok(()),
                Action::Failed(message) => return Err(message),
                Action::Wait => {
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    let pause = POLL.min(remaining);

                    if pause.is_zero() {
                        continue;
                    }

                    tokio::time::sleep(pause).await;
                }
            }
        }
    }

    pub(crate) fn shutdown(&self) {
        match self.gate.try_lock() {
            Ok(mut gate) => gate.stop_owned(),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => {
                poisoned.into_inner().stop_owned();
            }
            Err(std::sync::TryLockError::WouldBlock) => {}
        }
    }
}

impl Drop for Brain {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[derive(Debug)]
struct LiveChild {
    child: Child,
}

impl ChildProc for LiveChild {
    fn running(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for LiveChild {
    fn drop(&mut self) {
        self.stop();
    }
}

fn spawn_ollama(spec: &SpawnSpec) -> Result<LiveChild, String> {
    let mut command = Command::new(&spec.executable);
    command
        .args(&spec.args)
        .env("OLLAMA_HOST", &spec.host)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_console(&mut command);
    let child = command.spawn().map_err(|err| err.to_string())?;
    Ok(LiveChild { child })
}

#[cfg(windows)]
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

async fn probe_ready(client: &Client, readiness: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(readiness) else {
        return false;
    };

    let Ok(response) = client.get(url).timeout(PROBE).send().await else {
        return false;
    };

    let status = response.status();

    if response.content_length().is_none_or(|len| len <= 65_536) {
        let _ = response.bytes().await;
    }

    status.is_success()
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
#[path = "runtime_test.rs"]
mod tests;
