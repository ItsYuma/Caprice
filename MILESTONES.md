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
- The listener is `captureListener`. Inside the Tauri window, Rust records the default microphone and a speech worker transcribes it. The worker loads the selected engine once and stays until the window exits
- `CAPRICE_STT_ENGINE=bark` loads Underdog Bark 3.0 Pro from `CAPRICE_STT_MODEL` (`config.json`, `tokenizer.json`, `model.safetensors`). Empty or `onnx` loads the int8 ONNX directory. No model path is hardcoded
- Spoken replies use `CAPRICE_TTS_ENGINE`. Empty or `http` posts to `CAPRICE_TTS_URL` with `CAPRICE_TTS_MODEL`. Optional `CAPRICE_TTS_VOICE` and `CAPRICE_TTS_API_KEY`. `woof` is a resident `python3` child pointed at the Underdog Woof directory in `CAPRICE_TTS_WOOF`. Rust returns the bytes. The page plays them
- `scriptedListener` and `recordingSpeaker` stay for tests
- No microphone name, sample rate, host, or model id is hardcoded. Caprice does not shell out to Handy or Parakeet and does not use the Web Speech API
- WebKitGTK does not matter for speech. A window manager can still steal Alt+Space. The button still works

## 3. One computer tool

One `Tool`. The host confirms the call before `run`. `skills/host` is the instruction the model sees. Rust does the OS work. Core stays free of Tauri.

## 4. Day to day

A task list behind tools. Lines survive a restart. Nothing else until that list is boring to use.
