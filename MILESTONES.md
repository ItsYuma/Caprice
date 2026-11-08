# Milestones

The order is the product. A milestone is done when the row's check is true in the tree, not when a branch exists.

## 0. Shell

Done in the first architecture pass.

- Bun workspace: `packages/core`, `packages/voice`, `packages/desktop`
- `Session` takes a persona, a `Model`, and tools, and records host and capri lines
- `Listener` and `Speaker` exist, with a scripted listener and a recording speaker
- The Tauri window sends a line through `sayAndSpeak` on the stub model
- `skills/capri` and `skills/host` are the model-facing text

## 1. One local model

Done.

- `chatModel` posts to a chat endpoint with no cloud account
- `CAPRICE_MODEL_URL` and `CAPRICE_MODEL` come from the environment. The source has no host, port, or model name
- `personaText` is the system message
- `stubModel` remains for tests

## 2. Voice

Done.

- Hold Alt+Space while the window is focused, or hold the button. Release sends the transcript
- `listenAndSay` passes that text to `say`, then the page plays the capri line
- The listener is `captureListener`. Inside the Tauri window, Rust records the default microphone and transcribes it with the resident ONNX engine. Those weights load once and stay until the window exits. Underdog Bark 3.0 Pro is the model we want, and this loader cannot open its safetensors
- `CAPRICE_STT_MODEL` is the ONNX directory the shell can load. The shell loads the int8 weights. No model path is hardcoded
- Spoken replies need `CAPRICE_TTS_URL` and `CAPRICE_TTS_MODEL`. Optional `CAPRICE_TTS_VOICE` and `CAPRICE_TTS_API_KEY`. Rust posts inside the window. The page plays the bytes. There is no resident TTS model
- `scriptedListener` and `recordingSpeaker` stay for tests
- No microphone name, sample rate, host, or model id is hardcoded. Caprice does not shell out to Handy or Parakeet and does not use the Web Speech API
- WebKitGTK does not matter for speech. A window manager can still steal Alt+Space. The button still works

## 3. One computer tool

One `Tool`. The host confirms the call before `run`. `skills/host` is the instruction the model sees. Rust does the OS work. Core stays free of Tauri.

## 4. Day to day

A task list behind tools. Lines survive a restart. Nothing else until that list is boring to use.
