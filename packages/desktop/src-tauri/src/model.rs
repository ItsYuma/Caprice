mod runtime;

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;
use tokio::sync::watch;

use runtime::{Brain, Kind, Plan};

const MODEL_DEADLINE_MS: u64 = 60_000;
const READY_DEADLINE_MS: u64 = 60_000;
const RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const PENDING_CAP: usize = 64;
const FINISHED_CAP: usize = 256;

#[derive(Clone)]
pub(crate) struct ModelState {
    inner: Arc<Inner>,
}

struct Inner {
    http: Result<reqwest::Client, String>,
    brain: Option<Brain>,
    flights: Mutex<Flights>,
}

struct Flight {
    generation: u64,
    cancel: watch::Sender<bool>,
}

#[derive(Debug)]
struct Ticket {
    id: String,
    generation: u64,
    cancel: watch::Receiver<bool>,
}

struct Flights {
    next: u64,
    inflight: HashMap<String, Flight>,
    pending: VecDeque<String>,
    finished: VecDeque<String>,
}

impl Flights {
    fn new() -> Self {
        Self {
            next: 1,
            inflight: HashMap::new(),
            pending: VecDeque::new(),
            finished: VecDeque::new(),
        }
    }

    fn begin(&mut self, request_id: &str) -> Result<Ticket, String> {
        let id = require_id(request_id)?;

        if take_pending(&mut self.pending, id) {
            self.remember(id);
            return Err("cancelled".to_string());
        }

        if self.inflight.contains_key(id) {
            return Err("request id is already in use".to_string());
        }

        if self.finished.iter().any(|done| done == id) {
            return Err("request id is already finished".to_string());
        }

        let generation = self.next;
        self.next = self.next.wrapping_add(1);
        let (sender, cancel) = watch::channel(false);
        self.inflight.insert(
            id.to_string(),
            Flight {
                generation,
                cancel: sender,
            },
        );

        Ok(Ticket {
            id: id.to_string(),
            generation,
            cancel,
        })
    }

    fn cancel(&mut self, request_id: &str) -> Result<(), String> {
        let id = require_id(request_id)?;

        let failed = match self.inflight.get(id) {
            Some(flight) => flight.cancel.send(true).is_err(),
            None => false,
        };

        if failed {
            self.inflight.remove(id);
            self.remember(id);
            return Ok(());
        }

        if self.inflight.contains_key(id) || self.finished.iter().any(|done| done == id) {
            return Ok(());
        }

        if self.pending.iter().any(|pending| pending == id) {
            return Ok(());
        }

        if self.pending.len() == PENDING_CAP {
            self.pending.pop_front();
        }

        self.pending.push_back(id.to_string());
        Ok(())
    }

    fn finish(&mut self, ticket: &Ticket) {
        let current = self
            .inflight
            .get(&ticket.id)
            .map(|flight| flight.generation);

        if current == Some(ticket.generation) {
            self.inflight.remove(&ticket.id);
        } else if current.is_some() {
            return;
        }

        self.pending.retain(|pending| pending != &ticket.id);
        self.remember(&ticket.id);
    }

    fn remember(&mut self, id: &str) {
        if self.finished.iter().any(|done| done == id) {
            return;
        }

        if self.finished.len() == FINISHED_CAP {
            self.finished.pop_front();
        }

        self.finished.push_back(id.to_string());
    }
}

fn take_pending(pending: &mut VecDeque<String>, id: &str) -> bool {
    let before = pending.len();
    pending.retain(|item| item != id);
    pending.len() != before
}

fn require_id(request_id: &str) -> Result<&str, String> {
    if request_id.trim().is_empty() {
        Err("request id is required".to_string())
    } else {
        Ok(request_id)
    }
}

impl ModelState {
    pub(crate) fn new() -> Self {
        let http = build_client();
        let brain = http.as_ref().ok().cloned().map(Brain::new);
        Self {
            inner: Arc::new(Inner {
                http,
                brain,
                flights: Mutex::new(Flights::new()),
            }),
        }
    }

    pub(crate) fn shutdown(&self) {
        if let Some(brain) = &self.inner.brain {
            brain.shutdown();
        }
    }

    pub(crate) async fn complete(
        &self,
        body: String,
        request_id: String,
    ) -> Result<String, String> {
        let ticket = {
            let mut flights = lock(&self.inner.flights);
            flights.begin(&request_id)?
        };
        let result = self.dispatch(&ticket, body).await;
        lock(&self.inner.flights).finish(&ticket);
        result
    }

    pub(crate) fn cancel(&self, request_id: &str) -> Result<(), String> {
        lock(&self.inner.flights).cancel(request_id)
    }

    async fn dispatch(&self, ticket: &Ticket, body: String) -> Result<String, String> {
        if cancelled(&ticket.cancel) {
            return Err("cancelled".to_string());
        }

        let settings = load_settings()?;
        let http = self.client()?;
        let Some(brain) = self.inner.brain.as_ref() else {
            return Err("the model request failed".to_string());
        };
        let plan = settings.plan();
        let ready = settings.ready;

        tokio::select! {
            biased;
            () = until_cancelled(ticket.cancel.clone()) => {
                return Err("cancelled".to_string());
            }
            ensured = brain.ensure(&plan, ready) => ensured?,
        }

        if cancelled(&ticket.cancel) {
            return Err("cancelled".to_string());
        }

        exchange(&http, &settings, body, ticket.cancel.clone()).await
    }

    fn client(&self) -> Result<reqwest::Client, String> {
        match &self.inner.http {
            Ok(client) => Ok(client.clone()),
            Err(message) => Err(message.clone()),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EndpointPayload {
    model: String,
    protocol: String,
    timeout_ms: u64,
}

#[tauri::command]
pub(crate) fn model_endpoint() -> Result<EndpointPayload, String> {
    Ok(load_settings()?.endpoint())
}

#[tauri::command]
pub(crate) async fn model_complete(
    state: tauri::State<'_, ModelState>,
    body: String,
    request_id: String,
) -> Result<String, String> {
    state.complete(body, request_id).await
}

#[tauri::command]
pub(crate) fn model_cancel(
    state: tauri::State<'_, ModelState>,
    request_id: String,
) -> Result<(), String> {
    state.cancel(&request_id)
}

pub(crate) fn shutdown<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(state) = app.try_state::<ModelState>() {
        state.shutdown();
    }
}

#[derive(Clone, Copy)]
enum Protocol {
    Text,
    Native,
}

impl Protocol {
    fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Native => "native",
        }
    }
}

struct Settings {
    url: reqwest::Url,
    model: String,
    api_key: String,
    protocol: Protocol,
    deadline: Duration,
    timeout_ms: u64,
    ready: Duration,
    kind: Kind,
    origin: String,
    executable: String,
    host: String,
    readiness: String,
}

impl Settings {
    fn endpoint(&self) -> EndpointPayload {
        EndpointPayload {
            model: self.model.clone(),
            protocol: self.protocol.as_str().to_string(),
            timeout_ms: self.timeout_ms,
        }
    }

    fn plan(&self) -> Plan {
        Plan {
            kind: self.kind,
            endpoint: self.origin.clone(),
            executable: self.executable.clone(),
            host: self.host.clone(),
            readiness: self.readiness.clone(),
        }
    }
}

fn load_settings() -> Result<Settings, String> {
    let url = read_url(&env_var("CAPRICE_MODEL_URL"))?;
    let model = read_model(&env_var("CAPRICE_MODEL"))?;
    let api_key = env_var("CAPRICE_MODEL_API_KEY").trim().to_string();
    let protocol = read_protocol(&env_var("CAPRICE_MODEL_PROTOCOL"))?;
    let (deadline, timeout_ms) = duration_ms("CAPRICE_MODEL_DEADLINE_MS", MODEL_DEADLINE_MS)?;
    let (ready, _) = duration_ms("CAPRICE_MODEL_READY_MS", READY_DEADLINE_MS)?;
    let (kind, executable) = read_runtime()?;
    let (origin, host, readiness) = endpoint_target(&url)?;

    Ok(Settings {
        url,
        model,
        api_key,
        protocol,
        deadline,
        timeout_ms,
        ready,
        kind,
        origin,
        executable,
        host,
        readiness,
    })
}

fn env_var(name: &str) -> String {
    std::env::var(name).unwrap_or_default()
}

fn read_model(raw: &str) -> Result<String, String> {
    let text = raw.trim();

    if text.is_empty() {
        Err("CAPRICE_MODEL is required".to_string())
    } else {
        Ok(text.to_string())
    }
}

fn read_protocol(raw: &str) -> Result<Protocol, String> {
    match raw.trim() {
        "" | "text" => Ok(Protocol::Text),
        "native" => Ok(Protocol::Native),
        _ => Err("CAPRICE_MODEL_PROTOCOL is text or native".to_string()),
    }
}

fn read_url(raw: &str) -> Result<reqwest::Url, String> {
    let text = raw.trim();

    if text.is_empty() {
        return Err("CAPRICE_MODEL_URL is required".to_string());
    }

    let url = reqwest::Url::parse(text)
        .map_err(|_| "CAPRICE_MODEL_URL is not an http url".to_string())?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("CAPRICE_MODEL_URL is not an http url".to_string());
    }

    if !url.username().is_empty() || url.password().is_some() || url.host_str().is_none() {
        return Err("CAPRICE_MODEL_URL is not an http url".to_string());
    }

    Ok(url)
}

fn read_runtime() -> Result<(Kind, String), String> {
    match env_var("CAPRICE_MODEL_RUNTIME").trim() {
        "" | "external" => Ok((Kind::External, String::new())),
        "ollama" => {
            let executable = env_var("CAPRICE_MODEL_EXECUTABLE").trim().to_string();

            if executable.is_empty() {
                Err("CAPRICE_MODEL_EXECUTABLE is required".to_string())
            } else {
                Ok((Kind::Ollama, executable))
            }
        }
        _ => Err("CAPRICE_MODEL_RUNTIME is external or ollama".to_string()),
    }
}

fn endpoint_target(url: &reqwest::Url) -> Result<(String, String, String), String> {
    let host = url
        .host_str()
        .filter(|host| !host.is_empty())
        .ok_or_else(|| "CAPRICE_MODEL_URL is not an http url".to_string())?;
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "CAPRICE_MODEL_URL is not an http url".to_string())?;
    let bracket = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    let origin = format!("{}://{bracket}:{port}", url.scheme());
    let ollama_host = format!("{bracket}:{port}");
    let readiness = format!("{origin}/api/tags");
    Ok((origin, ollama_host, readiness))
}

fn duration_ms(name: &str, default_ms: u64) -> Result<(Duration, u64), String> {
    match std::env::var(name) {
        Err(_) => Ok((Duration::from_millis(default_ms), default_ms)),
        Ok(raw) => parse_ms(name, raw.trim(), default_ms),
    }
}

fn parse_ms(name: &str, raw: &str, default_ms: u64) -> Result<(Duration, u64), String> {
    if raw.is_empty() {
        return Ok((Duration::from_millis(default_ms), default_ms));
    }

    let ms: u64 = raw
        .parse()
        .map_err(|_| format!("{name} is not a whole number of milliseconds"))?;

    if ms == 0 {
        return Err(format!("{name} is not a whole number of milliseconds"));
    }

    Ok((Duration::from_millis(ms), ms))
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .pool_max_idle_per_host(4)
        .redirect(reqwest::redirect::Policy::limited(2))
        .build()
        .map_err(|err| err.to_string())
}

fn cancelled(cancel: &watch::Receiver<bool>) -> bool {
    *cancel.borrow()
}

async fn until_cancelled(mut cancel: watch::Receiver<bool>) {
    if *cancel.borrow() {
        return;
    }

    while cancel.changed().await.is_ok() {
        if *cancel.borrow() {
            return;
        }
    }
}

async fn exchange(
    client: &reqwest::Client,
    settings: &Settings,
    body: String,
    cancel: watch::Receiver<bool>,
) -> Result<String, String> {
    let mut request = client
        .post(settings.url.clone())
        .timeout(settings.deadline)
        .header("content-type", "application/json")
        .body(body);

    if !settings.api_key.is_empty() {
        let key = settings.api_key.clone();
        request = request.header("authorization", format!("Bearer {key}"));
    }

    let work = async move {
        let response = request.send().await.map_err(show_transport)?;
        let status = response.status();
        let text = read_capped(response, RESPONSE_BYTES).await?;

        if !status.is_success() {
            return Err(format!("model request failed: {}", status.as_u16()));
        }

        Ok(text)
    };

    tokio::pin!(work);
    let mut cancel = cancel;

    loop {
        if cancelled(&cancel) {
            return Err("cancelled".to_string());
        }

        tokio::select! {
            biased;
            changed = cancel.changed() => {
                if changed.is_err() || cancelled(&cancel) {
                    return Err("cancelled".to_string());
                }
            }
            result = &mut work => return result,
        }
    }
}

async fn read_capped(mut response: reqwest::Response, limit: usize) -> Result<String, String> {
    if response
        .content_length()
        .is_some_and(|len| len > limit as u64)
    {
        return Err("model reply is too large".to_string());
    }

    let mut body = Vec::new();

    while let Some(chunk) = response.chunk().await.map_err(show_transport)? {
        if body.len().saturating_add(chunk.len()) > limit {
            return Err("model reply is too large".to_string());
        }

        body.extend_from_slice(&chunk);
    }

    String::from_utf8(body).map_err(|_| "model reply is not utf-8".to_string())
}

fn show_transport(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "the model timed out".to_string()
    } else {
        "the model request failed".to_string()
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[cfg(test)]
#[path = "model_test.rs"]
mod tests;
