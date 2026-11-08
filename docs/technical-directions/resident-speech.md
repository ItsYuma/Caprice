# Resident speech

The microphone stays in the Tauri process. The weights stay in a child process. TypeScript receives a transcript through `Listener`.

The parent records, resamples to 16 kHz mono, and owns a state machine: `Idle` or `Live`. The first clip moves `Idle` to a spawned worker, sends `load`, and on `ready` sends `transcribe`. The worker handle lives only inside `Live`. A failed load or a broken pipe drops it and returns to `Idle`. A failed clip leaves the worker `Live`. The machine is `drive` in `speech/phase.rs`.

The child is this binary started with `--speech-worker`. It reads one JSON object per line and writes one JSON object per line: `load`, `transcribe`, `ready`, `text`, `error`. `Engine` is the set of models that child can load. `CAPRICE_STT_ENGINE` selects the variant (`onnx` when empty). `CAPRICE_STT_MODEL` is the directory. A new speech model is a new `EngineKind`, a new `Engine` variant, and a match arm in `Engine::load`. The protocol and the state machine stay as they are.

`Onnx` reads an int8 directory through `transcribe-rs` 0.3.12, so `ort` stays pinned to `2.0.0-rc.12`. `Bark` reads a `ParakeetForTDT` checkpoint (`config.json`, `tokenizer.json`, `model.safetensors`) through telmo and keeps the weights in bf16. Before each clip it prepends a quarter second of silence, which is what the publisher's runner does. The checkpoint we load is [Underdog Bark 3.0 Pro](https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Pro). The licence is CC BY-NC 4.0. Its Core ML and MLX packages are the same weights in other runtimes.

Chat is HTTP. Spoken replies are a separate engine. Those choices are `chat-over-http.md` and `spoken-reply.md`.

Set aside: a TypeScript or Python process that owns the weights, and Whisper. One language loads speech models. The page reloads, and another language would be a second runtime to keep alive.
