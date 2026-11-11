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

- Hold Alt+Space or Ctrl+Space. A tap does not send. Release sends the transcript
- `listenAndSay` passes that text to `say`, then the page plays the capri line
- `hear` is transcription after release. `voice` ends when the audio bytes are ready
- The listener is `captureListener`. Inside the Tauri window, Rust records the default microphone and loads Parakeet in that process. There is no speech-worker child
- Empty `CAPRICE_STT_ENGINE`, or `parakeet`, streams a Parakeet GGUF from `CAPRICE_STT_MODEL` while the key is held and finalizes on release. `http` posts the whole clip to `CAPRICE_STT_URL`. No model path is hardcoded
- Spoken replies use `CAPRICE_TTS_ENGINE`. Empty or `http` posts to `CAPRICE_TTS_URL` with `CAPRICE_TTS_MODEL`. Optional `CAPRICE_TTS_VOICE` and `CAPRICE_TTS_API_KEY`. Rust returns the bytes. The page plays them
- `scriptedListener` and `recordingSpeaker` stay for tests
- No microphone name, sample rate, host, or model id is hardcoded. Caprice does not shell out to Handy and does not use the Web Speech API
- WebKitGTK does not matter for speech. Alt+Space and Ctrl+Space are a global hook while the shell is open. On macOS it needs Accessibility. On Linux it needs the `input` group

## 3. One computer tool

One `Tool`. `skills/host` is the instruction the model sees. The call runs when she names it. Rust does the OS work. Core stays free of Tauri.

League client tools are not this milestone. `league_live` and `league_lcu` call the local League client when she names them. The computer tool is still the one this row is waiting on.

## 4. Day to day

A task list behind tools. Lines survive a restart. Nothing else until that list is boring to use.
