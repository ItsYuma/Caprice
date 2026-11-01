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
- `listenAndSay` passes that text to `say`, then the speaker speaks the capri line
- The listener and speaker use the webview Web Speech API. `scriptedListener` and `recordingSpeaker` stay for tests
- No microphone name, sample rate, or speech model server is in the source. Caprice does not use Handy or Parakeet
- Listening needs microphone permission where the webview has recognition. WebKitGTK on Linux does not provide recognition or synthesis, and the window says so

## 3. One computer tool

One `Tool`. The host confirms the call before `run`. `skills/host` is the instruction the model sees. Rust does the OS work. Core stays free of Tauri.

## 4. Day to day

A task list behind tools. Lines survive a restart. Nothing else until that list is boring to use.
