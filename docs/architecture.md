# Architecture

Caprice is a desktop companion. The shell is Tauri. The page is React. The session, the model, and tools are TypeScript. Voice is a pair of ports. The listener is `captureListener`. Inside the Tauri window, Rust records the default microphone and a speech worker transcribes it.

`packages/core` imports neither `packages/voice` nor `packages/desktop`. `packages/voice` imports nothing from the other packages. `packages/desktop` is the only place that composes them. Skills are markdown the model reads. Core does not open files. The shell passes the skill text in.

```mermaid
flowchart TB
  subgraph shell [packages/desktop]
    window[React page]
    host[sayAndSpeak]
  end
  subgraph voice [packages/voice]
    listener[Listener]
    speaker[Speaker]
  end
  subgraph corepkg [packages/core]
    session[Session]
    model[Model]
    tools[Tool]
  end
  skills[skills]
  window --> host
  host --> listener
  host --> session
  host --> speaker
  skills --> window
  session --> model
  session --> tools
```

The page is React. `useSession` opens the session, holds to talk, and sends a line. `Presence` is the figure and the waveform. `Log` renders the lines only while the text control is on. The trouble line stays outside that control. `Talk` is the hold button. `Composer` is the form. Hold Alt+Space while the window is focused, or hold the button, and release. `listenAndSay` passes the heard text to `say`. `sayAndSpeak` speaks the capri line. The chord is `talkChord` in `packages/desktop/src/talk.ts`. It is a window shortcut, not a global one. Rust commands `speech_listen_start` and `speech_listen_stop` own the hold. The parent keeps a worker state of idle or live. The worker is this binary with `--speech-worker`. `CAPRICE_STT_ENGINE` selects the engine. `onnx` loads the int8 files from `CAPRICE_STT_MODEL`. `bark` loads the safetensors checkpoint from that directory. Either loads once and stays until the window exits. A new model is a new variant. Spoken replies call `speech_speak`. `CAPRICE_TTS_URL` and `CAPRICE_TTS_MODEL` are the endpoint and the model. Optional `CAPRICE_TTS_VOICE` and `CAPRICE_TTS_API_KEY`. Rust posts inside the window. Spoken replies are still bytes the page plays. There is no resident TTS model. Outside the window the page does not invoke. Listening fails, and speaking posts only when `CAPRICE_TTS_URL` and `CAPRICE_TTS_MODEL` are set. `scriptedListener` and `recordingSpeaker` stay for tests. No microphone name, host, or model path is hardcoded. Caprice does not start Handy and does not use the Web Speech API. WebKitGTK does not matter for speech. A window manager can still steal Alt+Space. The button still works. The window calls `chatModel`. `persona` is the system message. Each line becomes a user or assistant message. `hostText` is sent only when it is not already the last host line. `CAPRICE_MODEL_URL` is the full chat URL. `CAPRICE_MODEL` is the model name in the body. Neither has a default in the source. Inside the Tauri window those values come from the process environment, and Rust posts the request. Outside it, Vite passes the same names through and `postJson` posts. `tryCatch` turns a rejected request into a `Result`. The page checks `ok` before it reads `value`. A failed reply leaves the host line in the session, and the page shows `error.message`. The stub model remains for tests. It ignores the persona and quotes the host. Tools are stored on the session and are not called yet.

```mermaid
sequenceDiagram
  participant Host
  participant Listener
  participant Shell
  participant Worker
  participant Session
  participant Model
  participant Speaker
  Host->>Listener: hold Alt+Space
  Listener->>Shell: speech_listen_start
  Host->>Listener: release
  Listener->>Shell: speech_listen_stop
  Shell->>Worker: load once, then transcribe
  Worker-->>Shell: text
  Shell-->>Listener: transcript
  Listener-->>Host: heard text
  Host->>Session: say
  Session->>Model: persona, lines, hostText
  Model-->>Session: reply or error
  Session-->>Host: capri line or error
  Host->>Speaker: speech_speak
  Speaker-->>Host: audio bytes
```

Rust opens the window. It does not own the session. Computer tools, when they exist, cross that bridge from a `Tool` in core to a host implementation. One tool, one file, registered by name.
